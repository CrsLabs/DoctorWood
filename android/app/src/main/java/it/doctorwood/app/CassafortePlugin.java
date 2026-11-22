package it.doctorwood.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebView;

import androidx.activity.result.ActivityResult;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.security.KeyStore;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Cassaforte di DoctorWood.
 *
 * Impronta: una chiave AES-256 vive nell'Android Keystore (hardware quando c'e'). Si puo' usare SOLO dopo
 * un'impronta valida (BIOMETRIC_STRONG) ed e' cancellata dal sistema se qualcuno registra una nuova impronta.
 * La chiave non esce mai dal Keystore: qui si cifrano e decifrano solo pochi byte (la chiave dei dati,
 * generata e usata dal codice della pagina con WebCrypto).
 *
 * File: salvataggio con la finestra «Salva come» di Android, apertura con l'app del telefono (PDF) e stampa.
 * Nessuna di queste funzioni usa la rete.
 */
@CapacitorPlugin(name = "Cassaforte")
public class CassafortePlugin extends Plugin {

    private static final String ALIAS = "doctorwood_cassaforte_v1";
    /** Dispositivi senza impronta: la chiave si usa solo dopo il PIN, la sequenza o la password del dispositivo. */
    private static final String ALIAS_SEQUENZA = "doctorwood_cassaforte_sequenza_v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRASFORMAZIONE = "AES/GCM/NoPadding";

    @Override
    public void load() {
        super.load();
        // file temporanei di aperture e condivisioni precedenti (possono essere backup non cifrati): non restano in giro
        for (String nome : new String[] { "aperti", "condivisi" }) {
            File[] vecchi = new File(getContext().getCacheDir(), nome).listFiles();
            if (vecchi != null) for (File f : vecchi) //noinspection ResultOfMethodCallIgnored
                f.delete();
        }
        // le foto scattate con «Scatta foto»: l'app le ha già copiate nel rilievo, gli originali non servono più
        File scattate = getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES);
        File[] foto = scattate != null ? scattate.listFiles() : null;
        long unOraFa = System.currentTimeMillis() - 3600_000L;
        if (foto != null) for (File f : foto) if (f.getName().startsWith("JPEG_") && f.lastModified() < unOraFa) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    // ===================== IMPRONTA =====================

    private int statoBiometria() {
        return BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
    }

    @PluginMethod
    public void stato(PluginCall call) {
        int s = statoBiometria();
        String biometria;
        switch (s) {
            case BiometricManager.BIOMETRIC_SUCCESS: biometria = "pronta"; break;
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: biometria = "nessuna_impronta"; break;
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: biometria = "senza_sensore"; break;
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE: biometria = "sensore_non_disponibile"; break;
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED: biometria = "aggiornamento_richiesto"; break;
            default: biometria = "non_disponibile";
        }
        JSObject r = new JSObject();
        r.put("biometria", biometria);
        r.put("chiave", chiaveEsiste());
        // senza impronta: il dispositivo ha almeno PIN, sequenza o password? (serve per la cassaforte «con la sequenza»)
        android.app.KeyguardManager km = (android.app.KeyguardManager) getContext().getSystemService(android.content.Context.KEYGUARD_SERVICE);
        r.put("sequenza", km != null && km.isDeviceSecure());
        call.resolve(r);
    }

    private boolean chiaveEsiste() {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            return ks.containsAlias(ALIAS);
        } catch (Exception e) {
            return false;
        }
    }

    private SecretKey chiave(boolean creaSeManca) throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return (SecretKey) ks.getKey(ALIAS, null);
        if (!creaSeManca) return null;
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                // una nuova impronta registrata sul dispositivo rende la chiave inutilizzabile
                .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // ogni uso richiede un'impronta (niente finestra di validita', niente PIN del telefono al posto dell'impronta)
            b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        kg.init(b.build());
        return kg.generateKey();
    }

    @PluginMethod
    public void eliminaChiave(PluginCall call) {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE);
            ks.load(null);
            String alias = "sequenza".equals(call.getString("modo")) ? ALIAS_SEQUENZA : ALIAS;
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
            call.resolve();
        } catch (Exception e) {
            call.reject("Impossibile eliminare la chiave", "ERRORE", e);
        }
    }

    private int autenticatoriSblocco() {
        // impronta (o volto) forte; se non va, il PIN/sequenza del telefono
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                : BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    }

    /** puoSbloccare() -> { ok } : c'è un modo per verificare chi tiene il telefono (impronta o PIN del telefono) */
    @PluginMethod
    public void puoSbloccare(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ok", BiometricManager.from(getContext()).canAuthenticate(autenticatoriSblocco()) == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(r);
    }

    /** Quando è stata confermata l'ultima volta l'identità (impronta o PIN): serve alle azioni distruttive native. */
    static volatile long ultimaIdentita = 0;

    /** Nome di file sicuro: solo lettere, numeri, punto, trattino, trattino basso; mai solo punti. */
    static String nomeSicuro(String nome) {
        String n = (nome == null ? "" : nome).replaceAll("[^A-Za-z0-9._-]", "_");
        if (n.replace(".", "").isEmpty()) n = "file";
        return n.length() > 120 ? n.substring(n.length() - 120) : n;
    }

    /** verificaIdentita({ titolo?, sottotitolo? }) — impronta, oppure il PIN del telefono; nessuna chiave in gioco */
    @PluginMethod
    public void verificaIdentita(PluginCall call) {
        String titolo = call.getString("titolo", "DoctorWood");
        String sottotitolo = call.getString("sottotitolo", "Sblocca per continuare");
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            try {
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(titolo)
                        .setSubtitle(sottotitolo)
                        .setAllowedAuthenticators(autenticatoriSblocco())
                        .setConfirmationRequired(false)
                        .build();
                new BiometricPrompt((FragmentActivity) a, ContextCompat.getMainExecutor(a), new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        ultimaIdentita = android.os.SystemClock.elapsedRealtime();
                        call.resolve();
                    }

                    @Override
                    public void onAuthenticationError(int codice, CharSequence msg) {
                        call.reject(String.valueOf(msg), codice == BiometricPrompt.ERROR_USER_CANCELED || codice == BiometricPrompt.ERROR_CANCELED
                                || codice == BiometricPrompt.ERROR_NEGATIVE_BUTTON ? "ANNULLATO" : "ERRORE");
                    }
                }).authenticate(info);
            } catch (Exception e) {
                call.reject("Sblocco non disponibile: " + e.getMessage(), "ERRORE", e);
            }
        });
    }

    /** cifra({ dati: base64, titolo?, sottotitolo? }) -> { iv, dati } — chiede l'impronta */
    @PluginMethod
    public void cifra(PluginCall call) {
        String dati = call.getString("dati");
        if (dati == null) { call.reject("Mancano i dati", "DATI"); return; }
        if (statoBiometria() != BiometricManager.BIOMETRIC_SUCCESS) { call.reject("Impronta non disponibile", "NON_DISPONIBILE"); return; }
        Cipher cipher;
        try {
            SecretKey k = chiave(true);
            cipher = Cipher.getInstance(TRASFORMAZIONE);
            cipher.init(Cipher.ENCRYPT_MODE, k);
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("La chiave non e' piu' valida (impronte cambiate)", "CHIAVE_INVALIDATA");
            return;
        } catch (Exception e) {
            call.reject("Errore della cassaforte: " + e.getMessage(), "ERRORE", e);
            return;
        }
        final byte[] chiaro = Base64.decode(dati, Base64.NO_WRAP);
        chiediImpronta(call, cipher, c -> {
            byte[] cifrato = c.doFinal(chiaro);
            JSObject r = new JSObject();
            r.put("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP));
            r.put("dati", Base64.encodeToString(cifrato, Base64.NO_WRAP));
            return r;
        });
    }

    /** decifra({ iv, dati, titolo?, sottotitolo? }) -> { dati: base64 } — chiede l'impronta */
    @PluginMethod
    public void decifra(PluginCall call) {
        String iv = call.getString("iv"), dati = call.getString("dati");
        if (iv == null || dati == null) { call.reject("Mancano i dati", "DATI"); return; }
        if (statoBiometria() != BiometricManager.BIOMETRIC_SUCCESS) { call.reject("Impronta non disponibile", "NON_DISPONIBILE"); return; }
        Cipher cipher;
        try {
            SecretKey k = chiave(false);
            if (k == null) { call.reject("Chiave assente", "CHIAVE_INVALIDATA"); return; }
            cipher = Cipher.getInstance(TRASFORMAZIONE);
            cipher.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("La chiave non e' piu' valida (impronte cambiate)", "CHIAVE_INVALIDATA");
            return;
        } catch (Exception e) {
            call.reject("Errore della cassaforte: " + e.getMessage(), "ERRORE", e);
            return;
        }
        final byte[] cifrato = Base64.decode(dati, Base64.NO_WRAP);
        chiediImpronta(call, cipher, c -> {
            JSObject r = new JSObject();
            r.put("dati", Base64.encodeToString(c.doFinal(cifrato), Base64.NO_WRAP));
            return r;
        });
    }

    private interface Operazione { JSObject esegui(Cipher c) throws Exception; }

    private void chiediImpronta(PluginCall call, Cipher cipher, Operazione op) {
        String titolo = call.getString("titolo", "DoctorWood");
        String sottotitolo = call.getString("sottotitolo", "Appoggia il dito del titolare");
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(titolo)
                    .setSubtitle(sottotitolo)
                    .setNegativeButtonText("Annulla")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setConfirmationRequired(false)
                    .build();
            BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) a, ContextCompat.getMainExecutor(a),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            try {
                                BiometricPrompt.CryptoObject co = result.getCryptoObject();
                                if (co == null || co.getCipher() == null) { call.reject("Impronta senza chiave", "ERRORE"); return; }
                                call.resolve(op.esegui(co.getCipher()));
                            } catch (Exception e) {
                                // decifrare con la chiave sbagliata o dati rovinati: AEADBadTagException
                                call.reject("Dati non decifrabili", "DATI_NON_VALIDI", e);
                            }
                        }

                        @Override
                        public void onAuthenticationError(int codice, CharSequence msg) {
                            String c;
                            switch (codice) {
                                case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
                                case BiometricPrompt.ERROR_USER_CANCELED:
                                case BiometricPrompt.ERROR_CANCELED: c = "ANNULLATO"; break;
                                case BiometricPrompt.ERROR_LOCKOUT:
                                case BiometricPrompt.ERROR_LOCKOUT_PERMANENT: c = "BLOCCATO"; break;
                                default: c = "ERRORE";
                            }
                            call.reject(String.valueOf(msg), c);
                        }
                        // onAuthenticationFailed: dito non riconosciuto, il sistema lascia riprovare da solo
                    });
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    // ===================== SENZA IMPRONTA: PIN, SEQUENZA O PASSWORD DEL DISPOSITIVO =====================
    // Stessa idea dell'impronta, con un'altra chiave del Keystore: si usa solo subito dopo aver dimostrato di conoscere
    // il blocco del dispositivo. Se il blocco viene tolto, Android cancella la chiave (resta la password di emergenza).
    // Da Android 11 la conferma vale per una sola operazione; su Android 10 per pochi secondi.

    private boolean dispositivoProtetto() {
        android.app.KeyguardManager km = (android.app.KeyguardManager) getContext().getSystemService(android.content.Context.KEYGUARD_SERVICE);
        return km != null && km.isDeviceSecure();
    }

    private SecretKey chiaveSequenza(boolean creaSeManca) throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(ALIAS_SEQUENZA)) return (SecretKey) ks.getKey(ALIAS_SEQUENZA, null);
        if (!creaSeManca) return null;
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS_SEQUENZA,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_DEVICE_CREDENTIAL);
        else setValiditaVecchia(b);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        kg.init(b.build());
        return kg.generateKey();
    }

    @SuppressWarnings("deprecation")
    private static void setValiditaVecchia(KeyGenParameterSpec.Builder b) { b.setUserAuthenticationValidityDurationSeconds(20); }

    /** cifraSequenza({ dati, titolo?, sottotitolo? }) -> { iv, dati } — chiede PIN / sequenza / password del dispositivo */
    @PluginMethod
    public void cifraSequenza(PluginCall call) {
        String dati = call.getString("dati");
        if (dati == null) { call.reject("Mancano i dati", "DATI"); return; }
        if (!dispositivoProtetto()) { call.reject("Il dispositivo non ha PIN, sequenza o password", "NON_DISPONIBILE"); return; }
        final byte[] chiaro = Base64.decode(dati, Base64.NO_WRAP);
        conSequenza(call, c -> { c.init(Cipher.ENCRYPT_MODE, chiaveSequenza(true)); return c; }, c -> {
            byte[] cifrato = c.doFinal(chiaro);
            JSObject r = new JSObject();
            r.put("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP));
            r.put("dati", Base64.encodeToString(cifrato, Base64.NO_WRAP));
            return r;
        });
    }

    /** decifraSequenza({ iv, dati, titolo?, sottotitolo? }) -> { dati } — chiede PIN / sequenza / password del dispositivo */
    @PluginMethod
    public void decifraSequenza(PluginCall call) {
        String iv = call.getString("iv"), dati = call.getString("dati");
        if (iv == null || dati == null) { call.reject("Mancano i dati", "DATI"); return; }
        if (!dispositivoProtetto()) { call.reject("Il dispositivo non ha più PIN, sequenza o password", "CHIAVE_INVALIDATA"); return; }
        final byte[] cifrato = Base64.decode(dati, Base64.NO_WRAP), vettore = Base64.decode(iv, Base64.NO_WRAP);
        conSequenza(call, c -> {
            SecretKey k = chiaveSequenza(false);
            if (k == null) throw new KeyPermanentlyInvalidatedException("chiave assente");
            c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, vettore)); return c;
        }, c -> {
            JSObject r = new JSObject();
            r.put("dati", Base64.encodeToString(c.doFinal(cifrato), Base64.NO_WRAP));
            return r;
        });
    }

    private interface Preparazione { Cipher prepara(Cipher c) throws Exception; }

    private void conSequenza(PluginCall call, Preparazione prepara, Operazione op) {
        String titolo = call.getString("titolo", "DoctorWood");
        String sottotitolo = call.getString("sottotitolo", "Sequenza o PIN del dispositivo");
        boolean nuovo = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
        final Cipher cipher;
        try {
            Cipher c = Cipher.getInstance(TRASFORMAZIONE);
            // da Android 11 la chiave si sblocca con l'operazione stessa (CryptoObject); su Android 10 si prepara dopo la conferma
            cipher = nuovo ? prepara.prepara(c) : c;
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("La chiave non è più valida (blocco del dispositivo cambiato)", "CHIAVE_INVALIDATA"); return;
        } catch (Exception e) {
            call.reject("Errore della cassaforte: " + e.getMessage(), "ERRORE", e); return;
        }
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(titolo).setSubtitle(sottotitolo)
                    .setAllowedAuthenticators(nuovo ? BiometricManager.Authenticators.DEVICE_CREDENTIAL
                        : BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                    .setConfirmationRequired(false).build();
            BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) a, ContextCompat.getMainExecutor(a),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            ultimaIdentita = android.os.SystemClock.elapsedRealtime();
                            try {
                                Cipher c;
                                if (nuovo) {
                                    BiometricPrompt.CryptoObject co = result.getCryptoObject();
                                    if (co == null || co.getCipher() == null) { call.reject("Conferma senza chiave", "ERRORE"); return; }
                                    c = co.getCipher();
                                } else c = prepara.prepara(cipher);
                                call.resolve(op.esegui(c));
                            } catch (KeyPermanentlyInvalidatedException e) {
                                call.reject("La chiave non è più valida (blocco del dispositivo cambiato)", "CHIAVE_INVALIDATA");
                            } catch (Exception e) {
                                call.reject("Dati non decifrabili", "DATI_NON_VALIDI", e);
                            }
                        }
                        @Override
                        public void onAuthenticationError(int codice, CharSequence msg) {
                            String c;
                            switch (codice) {
                                case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
                                case BiometricPrompt.ERROR_USER_CANCELED:
                                case BiometricPrompt.ERROR_CANCELED: c = "ANNULLATO"; break;
                                case BiometricPrompt.ERROR_LOCKOUT:
                                case BiometricPrompt.ERROR_LOCKOUT_PERMANENT: c = "BLOCCATO"; break;
                                default: c = "ERRORE";
                            }
                            call.reject(String.valueOf(msg), c);
                        }
                    });
            // un dispositivo che non accetta questa richiesta non deve far chiudere l'app: errore chiaro e basta
            try {
                if (nuovo) prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher)); else prompt.authenticate(info);
            } catch (Exception e) {
                call.reject("Questo dispositivo non permette di usare la sequenza per la cassaforte: " + e.getMessage(), "NON_DISPONIBILE", e);
            }
        });
    }

    /** apriImpostazioniImpronte() — apre le impostazioni di sicurezza di Android, dove si vedono e si tolgono le impronte */
    @PluginMethod
    public void apriImpostazioniImpronte(PluginCall call) {
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Impostazioni non disponibili", "ERRORE", e);
        }
    }

    // ===================== FILE =====================

    /** salvaFile({ nome, mime, dati: base64 }) -> { salvato: bool } — finestra «Salva come» di Android */
    @PluginMethod
    public void salvaFile(PluginCall call) {
        String nome = call.getString("nome", "doctorwood.txt");
        String mime = call.getString("mime", "application/octet-stream");
        if (call.getString("dati") == null) { call.reject("Mancano i dati", "DATI"); return; }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_TITLE, nome);
        startActivityForResult(call, i, "fileScelto");
    }

    @ActivityCallback
    private void fileScelto(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            r.put("salvato", false);
            call.resolve(r);
            return;
        }
        Uri uri = result.getData().getData();
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new Exception("destinazione non scrivibile");
            out.write(Base64.decode(call.getString("dati"), Base64.NO_WRAP));
            r.put("salvato", true);
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Salvataggio non riuscito: " + e.getMessage(), "ERRORE", e);
        }
    }

    /** apriFile({ nome, mime, dati: base64 }) — apre con l'app del telefono (es. il lettore PDF) */
    @PluginMethod
    public void apriFile(PluginCall call) {
        String nome = call.getString("nome", "file");
        String mime = call.getString("mime", "application/octet-stream");
        String dati = call.getString("dati");
        if (dati == null) { call.reject("Mancano i dati", "DATI"); return; }
        try {
            File cartella = new File(getContext().getCacheDir(), "aperti");
            // i file aperti in precedenza non servono piu'
            File[] vecchi = cartella.listFiles();
            if (vecchi != null) for (File f : vecchi) //noinspection ResultOfMethodCallIgnored
                f.delete();
            //noinspection ResultOfMethodCallIgnored
            cartella.mkdirs();
            File f = new File(cartella, UUID.randomUUID().toString().substring(0, 8) + "-" + nomeSicuro(nome));
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(Base64.decode(dati, Base64.NO_WRAP)); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(Intent.createChooser(i, nome).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
            call.resolve();
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("Nessuna app per aprire questo file", "NESSUNA_APP", e);
        } catch (Exception e) {
            call.reject("Apertura non riuscita: " + e.getMessage(), "ERRORE", e);
        }
    }

    /** barre({ chiaro, colore }) — barra di stato e barra in basso dello stesso colore dell'intestazione della pagina,
     *  con icone scure sul tema chiaro e chiare sul tema scuro (così l'ora si vede sempre) */
    @PluginMethod
    public void barre(PluginCall call) {
        final boolean chiaro = Boolean.TRUE.equals(call.getBoolean("chiaro", false));
        String c = call.getString("colore", "");
        int colore;
        try { colore = android.graphics.Color.parseColor(c != null && c.matches("#[0-9a-fA-F]{6}") ? c : (chiaro ? "#ffffff" : "#1e293b")); }
        catch (Exception e) { colore = chiaro ? 0xffffffff : 0xff1e293b; }
        final int col = colore;
        getActivity().runOnUiThread(() -> {
            android.view.Window w = getActivity().getWindow();
            w.getDecorView().setBackgroundColor(col);
            //noinspection deprecation
            w.setStatusBarColor(col);
            //noinspection deprecation
            w.setNavigationBarColor(col);
            androidx.core.view.WindowInsetsControllerCompat ic = androidx.core.view.WindowCompat.getInsetsController(w, w.getDecorView());
            ic.setAppearanceLightStatusBars(chiaro);
            ic.setAppearanceLightNavigationBars(chiaro);
            call.resolve();
        });
    }

    /** apriLink({ url }) — apre nel browser solo la pagina per sostenere l'app (Ko-fi) o GitHub; nient'altro */
    @PluginMethod
    public void apriLink(PluginCall call) {
        String u = call.getString("url", "");
        android.net.Uri x = android.net.Uri.parse(u == null ? "" : u);
        String h = x.getHost() == null ? "" : x.getHost().toLowerCase(java.util.Locale.ROOT);
        if (!"https".equals(x.getScheme()) || !(h.equals("ko-fi.com") || h.equals("github.com"))) { call.reject("Indirizzo non ammesso", "DATI"); return; }
        try { getActivity().startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, x).addCategory(android.content.Intent.CATEGORY_BROWSABLE)); call.resolve(); }
        catch (android.content.ActivityNotFoundException e) { call.reject("Nessun browser", "ASSENTE", e); }
    }

    /** apriUri({ uri, mime }) — apre con l'app del telefono un file già salvato (indirizzo dato da «Salva come» o dalla cartella dei documenti) */
    @PluginMethod
    public void apriUri(PluginCall call) {
        String u = call.getString("uri");
        if (u == null) { call.reject("Manca il file", "DATI"); return; }
        // solo un documento scelto dalla persona (indirizzo «content» di un'altra app): mai file interni né dati dell'app stessa
        Uri uri = Uri.parse(u);
        if (!"content".equals(uri.getScheme()) || uri.getAuthority() == null
                || uri.getAuthority().startsWith(getContext().getPackageName())) { call.reject("File non valido", "DATI"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, call.getString("mime", "application/octet-stream"));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("Nessuna app per aprire questo file", "NESSUNA_APP", e);
        } catch (Exception e) {
            call.reject("Apertura non riuscita: " + e.getMessage(), "ERRORE", e);
        }
    }

    // pagina di stampa: tenuta finché Android non ha finito di prepararla
    private WebView paginaStampa;

    /**
     * creaPdf({ nome, html }) — prepara un documento come PDF senza passare dal servizio di stampa di Android (che su
     * molti telefoni manca): risponde { dati: base64 }. L'app lo salva nella cartella dei documenti e lo apre.
     */
    @PluginMethod
    public void creaPdf(PluginCall call) {
        final String nome = call.getString("nome", "DoctorWood");
        final String html = call.getString("html");
        if (html == null || html.isEmpty()) { call.reject("Niente da stampare", "DATI"); return; }
        getActivity().runOnUiThread(() -> {
            try {
                if (paginaStampa != null) { try { ((android.view.ViewGroup) getActivity().getWindow().getDecorView()).removeView(paginaStampa); } catch (Exception ignorata) { } }
                final WebView wv = new WebView(getActivity());
                paginaStampa = wv;
                try {
                    wv.setAlpha(0f);
                    ((android.view.ViewGroup) getActivity().getWindow().getDecorView()).addView(wv, new android.view.ViewGroup.LayoutParams(2, 2));
                } catch (Exception ignorata) { }
                wv.getSettings().setJavaScriptEnabled(false);
                wv.getSettings().setBlockNetworkLoads(true);
                wv.getSettings().setAllowFileAccess(false);
                wv.getSettings().setAllowContentAccess(false);
                final boolean[] fatto = { false };
                wv.setWebViewClient(new android.webkit.WebViewClient() {
                    @Override public void onPageFinished(WebView v, String url) {
                        if (fatto[0]) return;
                        fatto[0] = true;
                        final String nomePulito = nome.replaceAll("[^A-Za-z0-9 ._-]", "_");
                        try {
                            File cartella = new File(getContext().getCacheDir(), "aperti");
                            File[] vecchi = cartella.listFiles();
                            if (vecchi != null) for (File f : vecchi) //noinspection ResultOfMethodCallIgnored
                                f.delete();
                            //noinspection ResultOfMethodCallIgnored
                            cartella.mkdirs();
                            final File pdf = new File(cartella, UUID.randomUUID().toString().substring(0, 8) + "-" + nomeSicuro(nomePulito) + ".pdf");
                            android.print.PdfDaPagina.scrivi(v.createPrintDocumentAdapter(nomePulito), pdf, new android.print.PdfDaPagina.Fine() {
                                @Override public void ok() {
                                    try {
                                        byte[] b = java.nio.file.Files.readAllBytes(pdf.toPath());
                                        //noinspection ResultOfMethodCallIgnored
                                        pdf.delete();
                                        call.resolve(new JSObject().put("dati", Base64.encodeToString(b, Base64.NO_WRAP)));
                                    } catch (Exception e2) {
                                        call.reject("PDF non letto: " + e2.getMessage(), "ERRORE", e2);
                                    }
                                    try { ((android.view.ViewGroup) getActivity().getWindow().getDecorView()).removeView(v); } catch (Exception ignorata) { }
                                }
                                @Override public void errore(String motivo) { call.reject("PDF non creato: " + motivo, "ERRORE"); }
                            });
                        } catch (Exception e) {
                            call.reject("PDF non creato: " + e.getMessage(), "ERRORE", e);
                        }
                    }
                });
                wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                call.reject("PDF non creato: " + e.getMessage(), "ERRORE", e);
            }
        });
    }

    /** condividiFile({ nome, mime, dati: base64, titolo? }) oppure ({ testo, titolo? }) — menu «Condividi» di Android (Drive, email...) */
    @PluginMethod
    public void condividiFile(PluginCall call) {
        String nome = call.getString("nome", "file");
        String mime = call.getString("mime", "application/octet-stream");
        String dati = call.getString("dati");
        String testo = call.getString("testo");
        if (dati == null && testo != null) {   // solo testo (es. una segnalazione): niente file
            Intent t = new Intent(Intent.ACTION_SEND);
            t.setType("text/plain");
            t.putExtra(Intent.EXTRA_TEXT, testo);
            getActivity().startActivity(Intent.createChooser(t, call.getString("titolo", "DoctorWood")));
            call.resolve();
            return;
        }
        if (dati == null) { call.reject("Mancano i dati", "DATI"); return; }
        try {
            File cartella = new File(getContext().getCacheDir(), "condivisi");
            File[] vecchi = cartella.listFiles();
            if (vecchi != null) for (File f : vecchi) //noinspection ResultOfMethodCallIgnored
                f.delete();
            //noinspection ResultOfMethodCallIgnored
            cartella.mkdirs();
            File f = new File(cartella, nomeSicuro(nome));
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(Base64.decode(dati, Base64.NO_WRAP)); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(mime);
            i.putExtra(Intent.EXTRA_STREAM, uri);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(i, call.getString("titolo", nome)));
            call.resolve();
        } catch (Exception e) {
            call.reject("Condivisione non riuscita: " + e.getMessage(), "ERRORE", e);
        }
    }

    // ===================== AGGIORNAMENTI DA GITHUB =====================
    // Fuori dal Play Store: la pagina chiede (una volta a settimana o quando tocchi «Controlla adesso») se c'è una versione nuova.
    // Il lavoro di rete è tutto qui, non nella pagina (che resta senza internet). Vedi Aggiornamento.java per i controlli.
    private Aggiornamento.Info ultimaTrovata;
    private File apkPronto;

    /** controllaAggiornamento() → { installata, nuova, versione?, novita?, dimensione? } */
    @PluginMethod
    public void controllaAggiornamento(PluginCall call) {
        new Thread(() -> {
            try {
                Context c = getContext();
                long mia = Aggiornamento.versioneInstallata(c);
                Aggiornamento.Info x = Aggiornamento.ultima(c);
                JSObject r = new JSObject();
                r.put("installata", mia);
                boolean nuova = x != null && x.versionCode > mia;
                r.put("nuova", nuova);
                if (nuova) { ultimaTrovata = x; r.put("versione", x.versione); r.put("novita", x.novita); r.put("dimensione", x.dimensione); }
                else Aggiornamento.pulisci(c);
                call.resolve(r);
            } catch (Exception e) { call.reject(messaggioAgg(e, "Non riesco a controllare: sei collegato a internet?")); }
        }, "aggiornamento").start();
    }

    /** scaricaAggiornamento() → scarica, controlla e apre l'installazione di Android (che chiede la conferma). Avanzamento: evento «aggiornamento» { percento } */
    @PluginMethod
    public void scaricaAggiornamento(PluginCall call) {
        final Aggiornamento.Info x = ultimaTrovata;
        if (x == null) { call.reject("Prima controlla se c'è una versione nuova"); return; }
        new Thread(() -> {
            try {
                apkPronto = Aggiornamento.scaricaEVerifica(getContext(), x, p -> { JSObject e = new JSObject(); e.put("percento", p); notifyListeners("aggiornamento", e); });
                getActivity().runOnUiThread(() -> installaOPermesso(call));
            } catch (SecurityException e) { call.reject(messaggioAgg(e, "File non valido"), "FIRMA"); }
            catch (Exception e) { call.reject(messaggioAgg(e, "Download non riuscito: riprova più tardi.")); }
        }, "aggiornamento").start();
    }

    private void installaOPermesso(PluginCall call) {
        sbloccaFissaggio();   // con l'app fissata sullo schermo (tablet del laboratorio) Android non aprirebbe né le impostazioni né l'installazione
        if (!getContext().getPackageManager().canRequestPackageInstalls()) {
            // la prima volta Android chiede di permettere a DoctorWood di installare app: si torna qui da soli
            Intent i = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, i, "dopoPermessoInstallazione");
            return;
        }
        installaApk(call);
    }

    @ActivityCallback
    private void dopoPermessoInstallazione(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (!getContext().getPackageManager().canRequestPackageInstalls()) { JSObject r = new JSObject(); r.put("permesso", false); call.resolve(r); return; }
        sbloccaFissaggio();
        installaApk(call);
    }

    private void sbloccaFissaggio() {
        try {
            ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE) getActivity().stopLockTask();
        } catch (Exception ignorata) { }
    }

    private void installaApk(PluginCall call) {
        File f = apkPronto;
        if (f == null || !f.isFile()) { call.reject("Il file non c'è più: tocca di nuovo Aggiorna"); return; }
        try {
            Uri u = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(u, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            JSObject r = new JSObject(); r.put("permesso", true); r.put("avviata", true); call.resolve(r);
        } catch (Exception e) { call.reject(messaggioAgg(e, "Non riesco ad aprire l'installazione")); }
    }

    private static String messaggioAgg(Exception e, String predefinito) {
        String m = e.getMessage();
        return m == null || m.isEmpty() || m.length() > 160 || e instanceof java.net.UnknownHostException || e instanceof java.net.SocketTimeoutException ? predefinito : m;
    }
}
