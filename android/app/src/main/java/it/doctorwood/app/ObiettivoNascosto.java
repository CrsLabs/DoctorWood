package it.doctorwood.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CameraMetadata;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Size;
import android.view.Surface;
import android.view.TextureView;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;

/**
 * Un obiettivo che il telefono non dichiara alle app (su vari Motorola il grandangolo): CameraX non lo vede,
 * ma spesso Camera2 lo apre lo stesso chiedendolo per numero. Anteprima su una TextureView, scatto JPEG,
 * flash, scena HDR, formato 4:3 / 16:9 e zoom digitale. Se il telefono rifiuta, lo dice e basta.
 */
final class ObiettivoNascosto {
    interface Esito { void ok(); void errore(String motivo); }
    interface Salvata { void ok(File f); void errore(String motivo); }

    private final CameraManager cm;
    private final String id;
    private final TextureView vista;
    private final CameraCharacteristics car;
    private final Handler principale = new Handler(Looper.getMainLooper());
    private HandlerThread filo;
    private Handler sfondo;
    private CameraDevice dispositivo;
    private CameraCaptureSession sessione;
    private ImageReader lettore;
    private Surface superficie;
    private CaptureRequest.Builder anteprima;
    private int flash;
    private boolean hdr;
    private float zoom = 1f;
    private Size dimAnteprima;
    private boolean chiuso = false;

    ObiettivoNascosto(Context c, String id, TextureView vista) throws CameraAccessException {
        this.cm = (CameraManager) c.getSystemService(Context.CAMERA_SERVICE);
        this.id = id;
        this.vista = vista;
        this.car = cm.getCameraCharacteristics(id);
    }

    boolean haFlash() { Boolean f = car.get(CameraCharacteristics.FLASH_INFO_AVAILABLE); return f != null && f; }

    boolean haScenaHdr() {
        int[] s = car.get(CameraCharacteristics.CONTROL_AVAILABLE_SCENE_MODES);
        if (s != null) for (int m : s) if (m == CameraMetadata.CONTROL_SCENE_MODE_HDR) return true;
        return false;
    }

    float zoomMassimo() {
        Float z = car.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM);
        return z == null ? 1f : Math.max(1f, Math.min(z, 4f));
    }

    /** Dimensioni dell'anteprima (in orizzontale, come le dà il sensore): servono per adattare la vista. */
    Size dimensioniAnteprima() { return dimAnteprima; }

    private static Size migliore(Size[] tutte, float rapporto, int latoMax) {
        Size scelta = null;
        for (Size s : tutte) {
            int l = Math.max(s.getWidth(), s.getHeight()), c = Math.min(s.getWidth(), s.getHeight());
            if (Math.abs((float) l / c - rapporto) > 0.02f || l > latoMax) continue;
            if (scelta == null || (long) s.getWidth() * s.getHeight() > (long) scelta.getWidth() * scelta.getHeight()) scelta = s;
        }
        if (scelta == null) for (Size s : tutte)   // nessuna con quel rapporto: la più grande
            if (Math.max(s.getWidth(), s.getHeight()) <= latoMax && (scelta == null || (long) s.getWidth() * s.getHeight() > (long) scelta.getWidth() * scelta.getHeight())) scelta = s;
        return scelta;
    }

    /** Apre l'obiettivo. La TextureView deve essere già pronta (con la sua superficie). */
    @SuppressLint("MissingPermission")
    void apri(boolean sediciNoni, int modoFlash, boolean conHdr, Esito esito) {
        flash = modoFlash;
        hdr = conHdr;
        try {
            filo = new HandlerThread("obiettivo-nascosto");
            filo.start();
            sfondo = new Handler(filo.getLooper());
            StreamConfigurationMap mappa = car.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            if (mappa == null) throw new IllegalStateException("nessun formato");
            float r = sediciNoni ? 16f / 9f : 4f / 3f;
            dimAnteprima = migliore(mappa.getOutputSizes(SurfaceTexture.class), r, 1920);
            Size foto = migliore(mappa.getOutputSizes(ImageFormat.JPEG), r, 10000);
            if (dimAnteprima == null || foto == null) throw new IllegalStateException("nessuna dimensione adatta");
            lettore = ImageReader.newInstance(foto.getWidth(), foto.getHeight(), ImageFormat.JPEG, 2);
            cm.openCamera(id, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice d) {
                    if (chiuso) { d.close(); return; }
                    dispositivo = d;
                    avviaSessione(esito);
                }
                @Override public void onDisconnected(CameraDevice d) { d.close(); dispositivo = null; }
                @Override public void onError(CameraDevice d, int errore) {
                    d.close(); dispositivo = null;
                    principale.post(() -> esito.errore("il telefono non lo lascia aprire (errore " + errore + ")"));
                }
            }, sfondo);
        } catch (Exception e) {
            chiudi();
            esito.errore(e.getMessage() == null ? e.toString() : e.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private void avviaSessione(Esito esito) {
        try {
            SurfaceTexture st = vista.getSurfaceTexture();
            if (st == null) throw new IllegalStateException("anteprima non pronta");
            st.setDefaultBufferSize(dimAnteprima.getWidth(), dimAnteprima.getHeight());
            superficie = new Surface(st);
            anteprima = dispositivo.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            anteprima.addTarget(superficie);
            impostazioni(anteprima);
            dispositivo.createCaptureSession(Arrays.asList(superficie, lettore.getSurface()), new CameraCaptureSession.StateCallback() {
                @Override public void onConfigured(CameraCaptureSession s) {
                    if (dispositivo == null) return;
                    sessione = s;
                    try {
                        s.setRepeatingRequest(anteprima.build(), null, sfondo);
                        principale.post(esito::ok);
                    } catch (Exception e) {
                        principale.post(() -> esito.errore(e.getMessage()));
                    }
                }
                @Override public void onConfigureFailed(CameraCaptureSession s) {
                    principale.post(() -> esito.errore("configurazione non riuscita"));
                }
            }, sfondo);
        } catch (Exception e) {
            principale.post(() -> esito.errore(e.getMessage()));
        }
    }

    /** Messa a fuoco, esposizione, flash, HDR e zoom comuni ad anteprima e scatto. */
    private void impostazioni(CaptureRequest.Builder b) {
        int[] af = car.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
        boolean continuo = false;
        if (af != null) for (int m : af) if (m == CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_PICTURE) continuo = true;
        if (continuo) b.set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
        if (hdr && haScenaHdr()) {
            b.set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_USE_SCENE_MODE);
            b.set(CaptureRequest.CONTROL_SCENE_MODE, CameraMetadata.CONTROL_SCENE_MODE_HDR);
        } else {
            b.set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO);
        }
        if (haFlash() && flash == 1 /* sì */) b.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_ON_ALWAYS_FLASH);
        else if (haFlash() && flash == 0 /* auto */) b.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_ON_AUTO_FLASH);
        else { b.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_ON); b.set(CaptureRequest.FLASH_MODE, CameraMetadata.FLASH_MODE_OFF); }
        Rect attivo = car.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
        if (attivo != null && zoom > 1.01f) {
            int w = Math.round(attivo.width() / zoom), h = Math.round(attivo.height() / zoom);
            int x = (attivo.width() - w) / 2, y = (attivo.height() - h) / 2;
            b.set(CaptureRequest.SCALER_CROP_REGION, new Rect(x, y, x + w, y + h));
        }
    }

    private void ripeti() {
        if (sessione == null || anteprima == null) return;
        try { impostazioni(anteprima); sessione.setRepeatingRequest(anteprima.build(), null, sfondo); } catch (Exception ignored) { }
    }

    /** Flash: 0 auto, 1 sì, 2 no (come ImageCapture.FLASH_MODE_*). */
    void flash(int modo) { flash = modo; ripeti(); }
    void hdr(boolean si) { hdr = si; ripeti(); }
    float zoom() { return zoom; }
    void zoom(float z) { zoom = Math.max(1f, Math.min(zoomMassimo(), z)); ripeti(); }

    /**
     * Scatta e salva il JPEG in «dest». gradiTelefono: 0, 90, 180, 270 (come lo tieni in mano).
     * Con il flash si fa prima la misura della luce (precattura), come le fotocamere vere.
     */
    void scatta(int gradiTelefono, File dest, Salvata esito) {
        if (sessione == null || dispositivo == null) { esito.errore("obiettivo non pronto"); return; }
        try {
            lettore.setOnImageAvailableListener(r -> {
                try (Image img = r.acquireLatestImage()) {
                    if (img == null) return;
                    ByteBuffer buf = img.getPlanes()[0].getBuffer();
                    byte[] dati = new byte[buf.remaining()];
                    buf.get(dati);
                    try (FileOutputStream out = new FileOutputStream(dest)) { out.write(dati); }
                    principale.post(() -> esito.ok(dest));
                } catch (Exception e) {
                    principale.post(() -> esito.errore(e.getMessage()));
                }
            }, sfondo);
            Integer sensore = car.get(CameraCharacteristics.SENSOR_ORIENTATION);
            int orientamento = ((sensore == null ? 90 : sensore) + gradiTelefono) % 360;
            Runnable vero = () -> {
                try {
                    CaptureRequest.Builder b = dispositivo.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
                    b.addTarget(lettore.getSurface());
                    impostazioni(b);
                    b.set(CaptureRequest.JPEG_ORIENTATION, orientamento);
                    b.set(CaptureRequest.JPEG_QUALITY, (byte) 95);
                    sessione.capture(b.build(), null, sfondo);
                } catch (Exception e) {
                    principale.post(() -> esito.errore(e.getMessage()));
                }
            };
            if (haFlash() && flash != 2) {
                CaptureRequest.Builder pre = dispositivo.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                pre.addTarget(superficie);
                impostazioni(pre);
                pre.set(CaptureRequest.CONTROL_AE_PRECAPTURE_TRIGGER, CameraMetadata.CONTROL_AE_PRECAPTURE_TRIGGER_START);
                sessione.capture(pre.build(), null, sfondo);
                sfondo.postDelayed(vero, 450);
            } else {
                vero.run();
            }
        } catch (Exception e) {
            esito.errore(e.getMessage());
        }
    }

    void chiudi() {
        chiuso = true;
        try { if (sessione != null) sessione.close(); } catch (Exception ignored) { }
        try { if (dispositivo != null) dispositivo.close(); } catch (Exception ignored) { }
        try { if (lettore != null) lettore.close(); } catch (Exception ignored) { }
        try { if (superficie != null) superficie.release(); } catch (Exception ignored) { }
        sessione = null; dispositivo = null; lettore = null; superficie = null;
        if (filo != null) { filo.quitSafely(); filo = null; }
    }
}
