package it.doctorwood.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileInputStream;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Funzioni di DoctorWood per il lavoro tra titolare e laboratorio:
 *  - cartella di sincronizzazione (scelta una volta con la finestra di Android; l'app NON usa la rete:
 *    a spostare i file è Syncthing, o un'app che tiene la cartella allineata con un cloud);
 *  - custodia di una chiave nel Keystore (legata all'hardware, senza impronta): protegge la chiave di sincronizzazione;
 *  - «Fissa app» (blocco sullo schermo di DoctorWood) per il tablet del laboratorio;
 *  - frequenza dello schermo (automatica, massima, 60 Hz).
 */
@CapacitorPlugin(name = "Laboratorio", permissions = { @Permission(alias = "fotocamera", strings = { android.Manifest.permission.CAMERA }) })
public class LaboratorioPlugin extends Plugin {

    private static final long MASSIMO_FILE = 50L * 1024 * 1024;

    // ===================== DIMENSIONE DEL TESTO =====================
    // Lo zoom del testo della WebView (come la grandezza dei caratteri di Android): cresce solo il testo, l'impaginazione
    // va a capo. Si ricorda qui, così all'apertura dell'app il testo è subito della dimensione giusta.
    private static final String PREF = "doctorwood_aspetto";

    @Override
    public void load() {
        int p = getContext().getSharedPreferences(PREF, android.content.Context.MODE_PRIVATE).getInt("testo", 100);
        if (p != 100 && getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().getSettings().setTextZoom(p);
    }

    /** dimensioneTesto({ percento: 100 | 115 | 130 }) */
    @PluginMethod
    public void dimensioneTesto(PluginCall call) {
        Integer p = call.getInt("percento");
        if (p == null || (p != 100 && p != 115 && p != 130)) { call.reject("dimensione non valida"); return; }
        getContext().getSharedPreferences(PREF, android.content.Context.MODE_PRIVATE).edit().putInt("testo", p).apply();
        getActivity().runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().getSettings().setTextZoom(p);
            call.resolve();
        });
    }

    // ===================== CARTELLA DI SINCRONIZZAZIONE =====================

    /** scegliCartella() -> { uri, nome } oppure { annullato: true } */
    @PluginMethod
    public void scegliCartella(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, i, "cartellaScelta");
    }

    @ActivityCallback
    private void cartellaScelta(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            r.put("annullato", true);
            call.resolve(r);
            return;
        }
        Uri albero = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(albero,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("La cartella non concede l'accesso permanente", "PERMESSO", e);
            return;
        }
        r.put("uri", albero.toString());
        r.put("nome", nomeCartella(albero));
        call.resolve(r);
    }

    private String nomeCartella(Uri albero) {
        Uri doc = DocumentsContract.buildDocumentUriUsingTree(albero, DocumentsContract.getTreeDocumentId(albero));
        try (Cursor c = getContext().getContentResolver().query(doc, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        return "cartella";
    }

    private Uri albero(PluginCall call) {
        String u = call.getString("uri");
        if (u == null) return null;
        Uri albero = Uri.parse(u);
        // si lavora solo su una cartella che l'utente ha concesso (permesso permanente ancora valido)
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(albero) && p.isReadPermission() && p.isWritePermission()) return albero;
        }
        return null;
    }

    /** verificaCartella({ uri }) -> { ok } */
    @PluginMethod
    public void verificaCartella(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ok", albero(call) != null);
        call.resolve(r);
    }

    /** dimenticaCartella({ uri }) — rinuncia al permesso sulla cartella */
    @PluginMethod
    public void dimenticaCartella(PluginCall call) {
        Uri a = albero(call);
        if (a != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(a,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) { }
        }
        call.resolve();
    }

    /** elencoCartella({ uri, prefisso? }) -> { file: [{ nome, modificato, dimensione }] } */
    @PluginMethod
    public void elencoCartella(PluginCall call) {
        Uri a = albero(call);
        if (a == null) { call.reject("Cartella non più accessibile", "CARTELLA"); return; }
        String prefisso = call.getString("prefisso", "");
        JSArray l = new JSArray();
        Uri figli = DocumentsContract.buildChildDocumentsUriUsingTree(a, DocumentsContract.getTreeDocumentId(a));
        try (Cursor c = getContext().getContentResolver().query(figli, new String[] {
                DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_MIME_TYPE }, null, null, null)) {
            while (c != null && c.moveToNext()) {
                String nome = c.getString(0);
                if (nome == null || !nome.startsWith(prefisso) || DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(3))) continue;
                JSObject f = new JSObject();
                f.put("nome", nome);
                f.put("modificato", c.isNull(1) ? 0 : c.getLong(1));
                f.put("dimensione", c.isNull(2) ? 0 : c.getLong(2));
                l.put(f);
            }
        } catch (Exception e) {
            call.reject("Cartella non leggibile: " + e.getMessage(), "CARTELLA", e);
            return;
        }
        JSObject r = new JSObject();
        r.put("file", l);
        call.resolve(r);
    }

    private Uri trova(Uri a, String nome) {
        Uri figli = DocumentsContract.buildChildDocumentsUriUsingTree(a, DocumentsContract.getTreeDocumentId(a));
        try (Cursor c = getContext().getContentResolver().query(figli, new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (nome.equals(c.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(a, c.getString(0));
            }
        } catch (Exception ignored) { }
        return null;
    }

    // ===================== CARTELLA DEI DOCUMENTI (ordinata per sezione e formato) =====================

    private static String nomePulito(String n) {
        String x = n == null ? "" : n.replaceAll("[\\\\/:*?\"<>|\\u0000-\\u001f]", "_").trim();
        while (x.startsWith(".")) x = x.substring(1);
        return x.isEmpty() ? "file" : (x.length() > 120 ? x.substring(0, 120) : x);
    }

    /** L'identificativo della sottocartella [nome] dentro [padreId] (la crea se manca). */
    private String sottocartella(Uri a, String padreId, String nome) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        Uri figli = DocumentsContract.buildChildDocumentsUriUsingTree(a, padreId);
        try (Cursor c = cr.query(figli, new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE }, null, null, null)) {
            while (c != null && c.moveToNext())
                if (nome.equals(c.getString(1)) && DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))) return c.getString(0);
        }
        Uri nuova = DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(a, padreId), DocumentsContract.Document.MIME_TYPE_DIR, nome);
        if (nuova == null) throw new Exception("impossibile creare la cartella «" + nome + "»");
        return DocumentsContract.getDocumentId(nuova);
    }

    private boolean esisteFiglio(Uri a, String padreId, String nome) {
        Uri figli = DocumentsContract.buildChildDocumentsUriUsingTree(a, padreId);
        try (Cursor c = getContext().getContentResolver().query(figli, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            while (c != null && c.moveToNext()) if (nome.equals(c.getString(0))) return true;
        } catch (Exception ignored) { }
        return false;
    }

    /**
     * salvaInCartella({ uri, percorso: ["Taglio", "PDF"], nome, mime, dati: base64 }) -> { uri, nome, percorso }
     * Mette il file nella cartella dei documenti scelta dalla persona, dentro le sottocartelle indicate (create se mancano).
     * Non sovrascrive mai: se il nome c'è già aggiunge un numero.
     */
    @PluginMethod
    public void salvaInCartella(PluginCall call) {
        Uri a = albero(call);
        if (a == null) { call.reject("La cartella dei documenti non è più accessibile", "CARTELLA"); return; }
        String dati = call.getString("dati");
        if (dati == null) { call.reject("Mancano i dati", "DATI"); return; }
        try {
            ContentResolver cr = getContext().getContentResolver();
            String id = DocumentsContract.getTreeDocumentId(a);
            StringBuilder via = new StringBuilder();
            JSArray perc = call.getArray("percorso");
            if (perc != null) for (int k = 0; k < perc.length() && k < 4; k++) {
                String n = nomePulito(perc.getString(k));
                id = sottocartella(a, id, n);
                via.append(via.length() > 0 ? " › " : "").append(n);
            }
            String nome = nomePulito(call.getString("nome", "documento"));
            String base = nome, est = "";
            int punto = nome.lastIndexOf('.');
            if (punto > 0) { base = nome.substring(0, punto); est = nome.substring(punto); }
            String finale = nome; int k = 2;
            while (esisteFiglio(a, id, finale)) finale = base + " (" + (k++) + ")" + est;
            Uri doc = DocumentsContract.createDocument(cr, DocumentsContract.buildDocumentUriUsingTree(a, id), call.getString("mime", "application/octet-stream"), finale);
            if (doc == null) throw new Exception("impossibile creare il file");
            try (OutputStream out = cr.openOutputStream(doc, "wt")) {
                if (out == null) throw new Exception("file non scrivibile");
                out.write(Base64.decode(dati, Base64.NO_WRAP));
            }
            JSObject r = new JSObject();
            r.put("uri", doc.toString()); r.put("nome", finale); r.put("percorso", via.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Salvataggio non riuscito: " + e.getMessage(), "SCRITTURA", e);
        }
    }

    private static boolean nomeValido(String nome) {
        return nome != null && nome.matches("[A-Za-z0-9._-]{1,120}");
    }

    /** leggiFile({ uri, nome }) -> { esiste, testo } */
    @PluginMethod
    public void leggiFile(PluginCall call) {
        Uri a = albero(call);
        String nome = call.getString("nome");
        if (a == null) { call.reject("Cartella non più accessibile", "CARTELLA"); return; }
        if (!nomeValido(nome)) { call.reject("Nome non valido", "NOME"); return; }
        JSObject r = new JSObject();
        Uri doc = trova(a, nome);
        if (doc == null) { r.put("esiste", false); call.resolve(r); return; }
        try (InputStream in = getContext().getContentResolver().openInputStream(doc)) {
            if (in == null) throw new Exception("file non leggibile");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            long tot = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                tot += n;
                if (tot > MASSIMO_FILE) throw new Exception("file troppo grande");
                out.write(buf, 0, n);
            }
            r.put("esiste", true);
            r.put("testo", new String(out.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Lettura non riuscita: " + e.getMessage(), "LETTURA", e);
        }
    }

    /** scriviFile({ uri, nome, testo }) — crea il file se manca, altrimenti lo sostituisce */
    @PluginMethod
    public void scriviFile(PluginCall call) {
        Uri a = albero(call);
        String nome = call.getString("nome"), testo = call.getString("testo");
        if (a == null) { call.reject("Cartella non più accessibile", "CARTELLA"); return; }
        if (!nomeValido(nome) || testo == null) { call.reject("Dati non validi", "NOME"); return; }
        ContentResolver cr = getContext().getContentResolver();
        try {
            Uri doc = trova(a, nome);
            if (doc == null) {
                Uri radice = DocumentsContract.buildDocumentUriUsingTree(a, DocumentsContract.getTreeDocumentId(a));
                doc = DocumentsContract.createDocument(cr, radice, "application/octet-stream", nome);
                if (doc == null) throw new Exception("impossibile creare il file");
            }
            try (OutputStream out = cr.openOutputStream(doc, "wt")) {
                if (out == null) throw new Exception("file non scrivibile");
                out.write(testo.getBytes(StandardCharsets.UTF_8));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Scrittura non riuscita: " + e.getMessage(), "SCRITTURA", e);
        }
    }

    /** eliminaFile({ uri, nome }) — cancella dalla cartella di sincronizzazione un file di DoctorWood (solo i suoi) */
    @PluginMethod
    public void eliminaFile(PluginCall call) {
        Uri a = albero(call);
        String nome = call.getString("nome");
        if (a == null) { call.reject("Cartella non più accessibile", "CARTELLA"); return; }
        if (!nomeValido(nome) || !nome.startsWith("doctorwood-") || !nome.endsWith(".dwsync")) { call.reject("Nome non valido", "NOME"); return; }
        try {
            Uri doc = trova(a, nome);
            if (doc != null && !DocumentsContract.deleteDocument(getContext().getContentResolver(), doc)) throw new Exception("non cancellato");
            call.resolve();
        } catch (Exception e) {
            call.reject("Cancellazione non riuscita: " + e.getMessage(), "CANCELLAZIONE", e);
        }
    }

    /**
     * cancellaTutto() — prima di disinstallare: toglie ogni permesso sulle cartelle, cancella le chiavi del Keystore
     * e tutti i dati dell'app (pagina, database, impostazioni, foto, cache). Android poi chiude l'app.
     */
    @PluginMethod
    public void cancellaTutto(PluginCall call) {
        // anche qui, non solo nella pagina: si cancella solo se impronta o PIN sono stati confermati nell'ultimo minuto
        long da = android.os.SystemClock.elapsedRealtime() - CassafortePlugin.ultimaIdentita;
        if (CassafortePlugin.ultimaIdentita == 0 || da > 60_000) { call.reject("Conferma l'identità prima di cancellare", "IDENTITA"); return; }
        CassafortePlugin.ultimaIdentita = 0;
        Context c = getContext();
        // la sincronizzazione diretta: chiude la porta, ferma il lavoro periodico, cancella chiave e abbinamenti
        try { pairwood.sdk.PairWood.cancellaTuttoSenzaAvviare(c, c.getPackageName()); } catch (Exception ignored) { }
        try {
            for (UriPermission p : c.getContentResolver().getPersistedUriPermissions()) {
                try { c.getContentResolver().releasePersistableUriPermission(p.getUri(), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Exception ignored) { }
            }
        } catch (Exception ignored) { }
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            for (String alias : java.util.Collections.list(ks.aliases())) { try { ks.deleteEntry(alias); } catch (Exception ignored) { } }
        } catch (Exception ignored) { }
        cancellaCartella(c.getCacheDir());
        cancellaCartella(c.getExternalCacheDir());
        cancellaCartella(c.getExternalFilesDir(null));
        call.resolve();
        // per ultimo: Android cancella tutto il resto (pagina, database, impostazioni) e chiude l'app
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null || !am.clearApplicationUserData()) {
                cancellaCartella(c.getFilesDir());
                Activity a = getActivity();
                if (a != null) a.finishAndRemoveTask();
            }
        }, 400);
    }

    private static void cancellaCartella(File f) {
        if (f == null || !f.exists()) return;
        File[] figli = f.listFiles();
        if (figli != null) for (File x : figli) {
            if (x.isDirectory()) cancellaCartella(x);
            //noinspection ResultOfMethodCallIgnored
            x.delete();
        }
    }

    // ===================== CUSTODIA (Keystore, senza impronta) =====================
    // La chiave di sincronizzazione resta sul dispositivo cifrata con una chiave hardware che non esce dal Keystore.

    private static final String ALIAS_CUSTODIA = "doctorwood_custodia_v1";

    private SecretKey chiaveCustodia() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS_CUSTODIA)) return (SecretKey) ks.getKey(ALIAS_CUSTODIA, null);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(ALIAS_CUSTODIA, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    /** custodisci({ dati: base64 }) -> { iv, dati } */
    @PluginMethod
    public void custodisci(PluginCall call) {
        String d = call.getString("dati");
        if (d == null) { call.reject("Mancano i dati", "DATI"); return; }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, chiaveCustodia());
            byte[] out = c.doFinal(Base64.decode(d, Base64.NO_WRAP));
            JSObject r = new JSObject();
            r.put("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP));
            r.put("dati", Base64.encodeToString(out, Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Custodia non riuscita: " + e.getMessage(), "ERRORE", e);
        }
    }

    /** riprendi({ iv, dati }) -> { dati: base64 } */
    @PluginMethod
    public void riprendi(PluginCall call) {
        String iv = call.getString("iv"), d = call.getString("dati");
        if (iv == null || d == null) { call.reject("Mancano i dati", "DATI"); return; }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, chiaveCustodia(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            JSObject r = new JSObject();
            r.put("dati", Base64.encodeToString(c.doFinal(Base64.decode(d, Base64.NO_WRAP)), Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Dato custodito non leggibile", "ERRORE", e);
        }
    }

    // ===================== FISSA APP =====================

    /** statoFissaggio() -> { fissata, gestita } (gestita = modalità kiosk di un dispositivo aziendale) */
    @PluginMethod
    public void statoFissaggio(PluginCall call) {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        int s = am.getLockTaskModeState();
        JSObject r = new JSObject();
        r.put("fissata", s != ActivityManager.LOCK_TASK_MODE_NONE);
        r.put("gestita", s == ActivityManager.LOCK_TASK_MODE_LOCKED);
        call.resolve(r);
    }

    @PluginMethod
    public void fissaApp(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                if (am.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_NONE) getActivity().startLockTask();
                call.resolve();
            } catch (Exception e) {
                call.reject("Impossibile fissare l'app: " + e.getMessage(), "ERRORE", e);
            }
        });
    }

    @PluginMethod
    public void sbloccaApp(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                if (am.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_PINNED) getActivity().stopLockTask();
            } catch (Exception ignored) { }
            call.resolve();
        });
    }

    /**
     * schermoIntero({ si }) — Laboratorio a tutto schermo: spariscono la barra di stato e i tasti di Android
     * (riappaiono per un attimo scorrendo dal bordo, poi si nascondono di nuovo).
     */
    @PluginMethod
    public void schermoIntero(PluginCall call) {
        boolean si = Boolean.TRUE.equals(call.getBoolean("si", true));
        getActivity().runOnUiThread(() -> {
            try {
                android.view.Window w = getActivity().getWindow();
                androidx.core.view.WindowInsetsControllerCompat ic = androidx.core.view.WindowCompat.getInsetsController(w, w.getDecorView());
                if (si) {
                    ic.setSystemBarsBehavior(androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    ic.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars());
                    w.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // in bottega lo schermo resta acceso
                } else {
                    ic.show(androidx.core.view.WindowInsetsCompat.Type.systemBars());
                    w.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            } catch (Exception ignored) { }
            call.resolve();
        });
    }

    /** apriImpostazioniSicurezza() — dove si attiva «Fissa app» e «Chiedi il PIN prima di sbloccare» */
    @PluginMethod
    public void apriImpostazioniSicurezza(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Impostazioni non disponibili", "ERRORE", e);
        }
    }

    // ===================== FOTOCAMERA =====================
    // scattaFoto({ massimo? }) -> { foto: [{ nome, dati: base64 }] } oppure { annullato: true }
    // La fotocamera di DoctorWood (CameraX); se la si sceglie, o se non funziona, quella del telefono.

    @PluginMethod
    public void scattaFoto(PluginCall call) {
        if (getPermissionState("fotocamera") != PermissionState.GRANTED) { requestPermissionForAlias("fotocamera", call, "permessoFotocamera"); return; }
        apriFotocamera(call);
    }

    @PermissionCallback
    private void permessoFotocamera(PluginCall call) {
        if (getPermissionState("fotocamera") == PermissionState.GRANTED) apriFotocamera(call);
        else call.reject("Permesso della fotocamera negato", "PERMESSO");
    }

    private void apriFotocamera(PluginCall call) {
        Intent i = new Intent(getContext(), FotocameraActivity.class);
        i.putExtra(FotocameraActivity.EXTRA_MASSIMO, call.getInt("massimo", 30));
        startActivityForResult(call, i, "fotoScattate");
    }

    @ActivityCallback
    private void fotoScattate(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == FotocameraActivity.RISULTATO_SISTEMA) { apriFotocameraSistema(call); return; }
        String[] percorsi = result.getData() != null ? result.getData().getStringArrayExtra(FotocameraActivity.EXTRA_FOTO) : null;
        if (result.getResultCode() != Activity.RESULT_OK || percorsi == null || percorsi.length == 0) {
            JSObject r = new JSObject(); r.put("annullato", true);
            if (result.getData() != null && result.getData().getBooleanExtra("uscita", false)) r.put("uscita", true);
            call.resolve(r); return;
        }
        consegnaFoto(call, percorsi);
    }

    private File fotoSistema;

    private void apriFotocameraSistema(PluginCall call) {
        try {
            File cartella = getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES);
            if (cartella == null) throw new Exception("memoria non disponibile");
            //noinspection ResultOfMethodCallIgnored
            cartella.mkdirs();
            fotoSistema = new File(cartella, "JPEG_" + System.currentTimeMillis() + ".jpg");
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", fotoSistema);
            Intent i = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(call, i, "fotoSistemaScattata");
        } catch (Exception e) {
            call.reject("Fotocamera del telefono non disponibile: " + e.getMessage(), "ERRORE", e);
        }
    }

    @ActivityCallback
    private void fotoSistemaScattata(PluginCall call, ActivityResult result) {
        if (call == null) return;
        File f = fotoSistema;
        fotoSistema = null;
        if (result.getResultCode() != Activity.RESULT_OK || f == null || !f.exists() || f.length() == 0) {
            if (f != null) //noinspection ResultOfMethodCallIgnored
                f.delete();
            JSObject r = new JSObject(); r.put("annullato", true); call.resolve(r); return;
        }
        try {
            File cartella = new File(getContext().getCacheDir(), "scatti");
            //noinspection ResultOfMethodCallIgnored
            cartella.mkdirs();
            File pronta = new File(cartella, "foto_" + System.currentTimeMillis() + ".jpg");
            FotoUtil.prepara(f, pronta);   // ridotta e raddrizzata come quelle della nostra fotocamera
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            consegnaFoto(call, new String[] { pronta.getAbsolutePath() });
        } catch (Exception e) {
            call.reject("Foto non leggibile: " + e.getMessage(), "ERRORE", e);
        }
    }

    private void consegnaFoto(PluginCall call, String[] percorsi) {
        JSArray l = new JSArray();
        int n = 0;
        for (String p : percorsi) {
            File f = new File(p);
            // solo i file che la fotocamera ha scritto nella cache dell'app
            if (!f.getParentFile().getName().equals("scatti") || !f.exists()) continue;
            try (FileInputStream in = new FileInputStream(f)) {
                byte[] b = new byte[(int) f.length()];
                int letti = 0;
                while (letti < b.length) { int k = in.read(b, letti, b.length - letti); if (k < 0) break; letti += k; }
                JSObject o = new JSObject();
                o.put("nome", "foto-" + (++n) + ".jpg");
                o.put("dati", Base64.encodeToString(b, 0, letti, Base64.NO_WRAP));
                l.put(o);
            } catch (Exception ignored) {
            } finally {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
        JSObject r = new JSObject();
        r.put("foto", l);
        call.resolve(r);
    }

    // ===================== VIBRAZIONE =====================
    // tempi = [vibra, pausa, vibra, ...] in ms; forza 0,4–2,5: dove il telefono lo permette regola anche
    // l'intensità del motore (non solo la durata), così «Leggera» e «Forte» si sentono davvero diverse.
    @PluginMethod
    public void vibra(PluginCall call) {
        try {
            org.json.JSONArray t = call.getArray("tempi");
            double forza = call.getDouble("forza", 1.0);
            if (t == null || t.length() == 0) { call.resolve(); return; }
            android.os.Vibrator v;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                android.os.VibratorManager vm = (android.os.VibratorManager) getContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                v = vm.getDefaultVibrator();
            } else {
                //noinspection deprecation
                v = (android.os.Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (v == null || !v.hasVibrator()) { call.resolve(); return; }
            int n = Math.min(t.length(), 20);
            long[] tempi = new long[n + 1];
            int[] ampiezze = new int[n + 1];
            int amp = (int) Math.round(Math.max(1, Math.min(255, 110 + (Math.max(0.4, Math.min(2.5, forza)) - 0.4) / 2.1 * 145)));
            tempi[0] = 0; ampiezze[0] = 0;   // si parte subito
            for (int i = 0; i < n; i++) {
                tempi[i + 1] = Math.max(1, Math.min(1000, t.getLong(i)));
                ampiezze[i + 1] = i % 2 == 0 ? (v.hasAmplitudeControl() ? amp : android.os.VibrationEffect.DEFAULT_AMPLITUDE) : 0;
            }
            v.vibrate(android.os.VibrationEffect.createWaveform(tempi, ampiezze, -1));
            call.resolve();
        } catch (Exception e) {
            call.reject("Vibrazione non riuscita", "ERRORE", e);
        }
    }

    // ===================== FREQUENZA DELLO SCHERMO =====================

    private Display schermo() {
        Activity a = getActivity();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return a.getDisplay();
        //noinspection deprecation
        return a.getWindowManager().getDefaultDisplay();
    }

    /** frequenze() -> { massima, minima, attuale } in Hz, per i modi con la stessa risoluzione */
    @PluginMethod
    public void frequenze(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Display d = schermo();
                Display.Mode ora = d.getMode();
                float max = ora.getRefreshRate(), min = ora.getRefreshRate();
                for (Display.Mode m : d.getSupportedModes()) {
                    if (m.getPhysicalWidth() != ora.getPhysicalWidth() || m.getPhysicalHeight() != ora.getPhysicalHeight()) continue;
                    max = Math.max(max, m.getRefreshRate());
                    min = Math.min(min, m.getRefreshRate());
                }
                JSObject r = new JSObject();
                r.put("massima", Math.round(max));
                r.put("minima", Math.round(min));
                r.put("attuale", Math.round(d.getRefreshRate()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Frequenza non disponibile", "ERRORE", e);
            }
        });
    }

    /** impostaFrequenza({ modo: 'auto' | 'massima' | '60' }) */
    @PluginMethod
    public void impostaFrequenza(PluginCall call) {
        String modo = call.getString("modo", "auto");
        getActivity().runOnUiThread(() -> {
            try {
                Window w = getActivity().getWindow();
                WindowManager.LayoutParams lp = w.getAttributes();
                Display d = schermo();
                Display.Mode ora = d.getMode(), scelto = null;
                if (!"auto".equals(modo)) {
                    float obiettivo = "60".equals(modo) ? 60f : Float.MAX_VALUE;
                    for (Display.Mode m : d.getSupportedModes()) {
                        if (m.getPhysicalWidth() != ora.getPhysicalWidth() || m.getPhysicalHeight() != ora.getPhysicalHeight()) continue;
                        if (scelto == null || Math.abs(m.getRefreshRate() - obiettivo) < Math.abs(scelto.getRefreshRate() - obiettivo)) scelto = m;
                    }
                }
                lp.preferredDisplayModeId = scelto == null ? 0 : scelto.getModeId();
                lp.preferredRefreshRate = scelto == null ? 0 : scelto.getRefreshRate();
                w.setAttributes(lp);
                JSObject r = new JSObject();
                r.put("hz", scelto == null ? 0 : Math.round(scelto.getRefreshRate()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Frequenza non impostata", "ERRORE", e);
            }
        });
    }
}
