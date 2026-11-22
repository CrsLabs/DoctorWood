package it.doctorwood.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

/**
 * Aggiornamenti dell'app da GitHub (fuori dal Play Store).
 *
 * Come funziona:
 *  1. si legge l'ultima «release» del repository con l'API di GitHub;
 *  2. tra i file della release deve esserci {@code aggiornamento.json}:
 *     { "pacchetto": "it.doctorwood.app", "versionCode": 48, "versione": "1.1.1",
 *       "apk": "DoctorWood-1.1.1.apk", "sha256": "…64 cifre esadecimali…", "novita": "testo breve" }
 *  3. l'APK si scarica solo dall'elenco dei file della stessa release (mai da un indirizzo scritto nel json),
 *     si controlla l'impronta SHA-256, il nome del pacchetto, che la versione sia più nuova e che la firma sia
 *     la stessa dell'app installata; poi lo installa Android, che chiede la conferma e ricontrolla la firma.
 *
 * Non parte nessun dato dell'utente: GitHub riceve solo una richiesta di lettura (come aprire una pagina web).
 */
final class Aggiornamento {
    private Aggiornamento() { }

    /** Il repository da cui arrivano gli aggiornamenti: se cambia nome, si cambia qui. */
    static final String PROPRIETARIO = "CrsLabs";
    static final String REPOSITORY = "DoctorWood";

    private static final int MAX_JSON = 256 * 1024;
    private static final long MAX_APK = 150L * 1024 * 1024;
    private static final String CARTELLA = "aggiornamenti";

    /** quello che si sa dell'ultima versione pubblicata */
    static final class Info {
        long versionCode;
        String versione, novita, sha256, urlApk, nomeApk;
        long dimensione;
    }

    interface Avanzamento { void percento(int p); }

    static long versioneInstallata(Context c) throws PackageManager.NameNotFoundException {
        return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).getLongVersionCode();
    }

    /** Legge l'ultima release; null se non c'è un aggiornamento valido. */
    static Info ultima(Context c) throws Exception {
        String api = "https://api.github.com/repos/" + PROPRIETARIO + "/" + REPOSITORY + "/releases/latest";
        JSONObject rel = new JSONObject(new String(scarica(api, MAX_JSON), "UTF-8"));
        if (rel.optBoolean("draft") || rel.optBoolean("prerelease")) return null;
        JSONArray file = rel.optJSONArray("assets");
        if (file == null) return null;
        String urlJson = null;
        for (int i = 0; i < file.length(); i++) {
            JSONObject f = file.getJSONObject(i);
            if ("aggiornamento.json".equals(f.optString("name"))) urlJson = f.optString("browser_download_url");
        }
        if (!indirizzoAmmesso(urlJson)) return null;
        JSONObject j = new JSONObject(new String(scarica(urlJson, MAX_JSON), "UTF-8"));
        if (!c.getPackageName().equals(j.optString("pacchetto"))) return null;
        Info x = new Info();
        x.versionCode = j.optLong("versionCode", 0);
        x.versione = testo(j.optString("versione"), 20);
        x.novita = testo(j.optString("novita"), 1500);
        x.sha256 = j.optString("sha256").toLowerCase(Locale.ROOT);
        x.nomeApk = j.optString("apk");
        if (x.versionCode <= 0 || !x.sha256.matches("[0-9a-f]{64}") || !x.nomeApk.matches("[A-Za-z0-9._-]{1,80}\\.apk")) return null;
        for (int i = 0; i < file.length(); i++) {
            JSONObject f = file.getJSONObject(i);
            if (x.nomeApk.equals(f.optString("name"))) { x.urlApk = f.optString("browser_download_url"); x.dimensione = f.optLong("size", 0); }
        }
        if (!indirizzoAmmesso(x.urlApk) || x.dimensione <= 0 || x.dimensione > MAX_APK) return null;
        return x;
    }

    /** Scarica l'APK e fa tutti i controlli; restituisce il file pronto da installare. */
    static File scaricaEVerifica(Context c, Info x, Avanzamento av) throws Exception {
        if (x.versionCode <= versioneInstallata(c)) throw new IOException("Hai già l'ultima versione");
        File dir = new File(c.getCacheDir(), CARTELLA);
        pulisci(c);
        if (!dir.mkdirs() && !dir.isDirectory()) throw new IOException("Spazio non disponibile");
        File apk = new File(dir, "DoctorWood-" + x.versionCode + ".apk");
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        HttpURLConnection h = apri(x.urlApk);
        try (InputStream in = h.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
            long tot = x.dimensione, letti = 0; int ultimo = -1;
            byte[] b = new byte[64 * 1024];
            for (int n; (n = in.read(b)) > 0; ) {
                letti += n;
                if (letti > MAX_APK || letti > tot) throw new IOException("Il file è più grande del previsto");
                md.update(b, 0, n); out.write(b, 0, n);
                int p = (int) (letti * 100 / tot);
                if (av != null && p != ultimo) { ultimo = p; av.percento(p); }
            }
            if (letti != tot) throw new IOException("Download incompleto");
        } finally { h.disconnect(); }
        if (!esadecimale(md.digest()).equals(x.sha256)) { apk.delete(); throw new SecurityException("Il file scaricato non è quello pubblicato (impronta diversa)"); }
        PackageManager pm = c.getPackageManager();
        PackageInfo nuovo = pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (nuovo == null || !c.getPackageName().equals(nuovo.packageName)) { apk.delete(); throw new SecurityException("Il file non è DoctorWood"); }
        if (nuovo.getLongVersionCode() != x.versionCode) { apk.delete(); throw new SecurityException("La versione del file non corrisponde"); }
        PackageInfo mio = pm.getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        // su alcune versioni di Android la firma di un file non installato non si legge: allora resta il controllo di Android
        if (nuovo.signingInfo != null && !stessaFirma(mio.signingInfo, nuovo.signingInfo)) { apk.delete(); throw new SecurityException("Il file non è firmato da CrsLabs"); }
        return apk;
    }

    static void pulisci(Context c) {
        File dir = new File(c.getCacheDir(), CARTELLA);
        File[] f = dir.listFiles();
        if (f != null) for (File x : f) //noinspection ResultOfMethodCallIgnored
            x.delete();
    }

    private static boolean stessaFirma(SigningInfo a, SigningInfo b) {
        if (a == null || b == null) return false;
        Signature[] sa = a.hasMultipleSigners() ? a.getApkContentsSigners() : a.getSigningCertificateHistory();
        Signature[] sb = b.hasMultipleSigners() ? b.getApkContentsSigners() : b.getSigningCertificateHistory();
        if (sa == null || sb == null || sa.length == 0 || sb.length == 0) return false;
        // il certificato attuale dell'app installata deve comparire tra quelli del file nuovo
        Signature attuale = sa[sa.length - 1];
        for (Signature s : sb) if (Arrays.equals(s.toByteArray(), attuale.toByteArray())) return true;
        return false;
    }

    /** solo GitHub, solo https */
    static boolean indirizzoAmmesso(String u) {
        if (u == null || u.isEmpty()) return false;
        try {
            URL url = new URL(u);
            String h = url.getHost().toLowerCase(Locale.ROOT);
            return "https".equals(url.getProtocol()) && (h.equals("github.com") || h.equals("api.github.com") || h.endsWith(".githubusercontent.com"));
        } catch (Exception e) { return false; }
    }

    private static HttpURLConnection apri(String u) throws IOException {
        // si seguono i rinvii a mano, per controllare che restino su GitHub e in https
        for (int i = 0; i < 6; i++) {
            if (!indirizzoAmmesso(u)) throw new SecurityException("Indirizzo non ammesso");
            HttpURLConnection h = (HttpURLConnection) new URL(u).openConnection();
            h.setInstanceFollowRedirects(false);
            h.setConnectTimeout(15000); h.setReadTimeout(30000);
            h.setRequestProperty("User-Agent", "DoctorWood");
            h.setRequestProperty("Accept", u.contains("api.github.com") ? "application/vnd.github+json" : "application/octet-stream");
            int r = h.getResponseCode();
            if (r >= 300 && r < 400) { String dove = h.getHeaderField("Location"); h.disconnect(); u = dove == null ? null : new URL(new URL(u), dove).toString(); continue; }
            if (r != 200) { h.disconnect(); throw new IOException(r == 404 ? "Nessuna versione pubblicata" : "GitHub ha risposto " + r); }
            return h;
        }
        throw new IOException("Troppi rinvii");
    }

    private static byte[] scarica(String u, int max) throws IOException {
        HttpURLConnection h = apri(u);
        try (InputStream in = h.getInputStream()) {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            for (int n; (n = in.read(b)) > 0; ) { o.write(b, 0, n); if (o.size() > max) throw new IOException("Risposta troppo grande"); }
            return o.toByteArray();
        } finally { h.disconnect(); }
    }

    private static String testo(String s, int max) {
        if (s == null) return "";
        s = s.replaceAll("[\\p{Cntrl}&&[^\\n]]", "").trim();
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static String esadecimale(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x));
        return s.toString();
    }
}
