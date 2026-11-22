package it.doctorwood.app;

import android.annotation.SuppressLint;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.drawable.GradientDrawable;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CameraMetadata;
import android.hardware.camera2.CaptureRequest;
import android.os.Build;
import android.util.SizeF;
import android.os.Bundle;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.OrientationEventListener;
import android.view.ScaleGestureDetector;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.annotation.OptIn;
import androidx.camera.camera2.interop.Camera2CameraControl;
import androidx.camera.camera2.interop.Camera2CameraInfo;
import androidx.camera.camera2.interop.CaptureRequestOptions;
import androidx.camera.camera2.interop.ExperimentalCamera2Interop;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraInfo;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.ZoomState;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.extensions.ExtensionMode;
import androidx.camera.extensions.ExtensionsManager;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Fotocamera di DoctorWood (CameraX): anteprima a tutto schermo con i colori dell'app, scatto grande, flash,
 * griglia, livella, zoom (pulsanti e due dita), obiettivi del telefono, HDR, formato 4:3 / 16:9 / 1:1,
 * messa a fuoco con un tocco, più foto di fila con le miniature.
 * Restituisce i percorsi delle foto già ridotte e raddrizzate; «Fotocamera del telefono» chiede di usare quella di sistema.
 */
public class FotocameraActivity extends AppCompatActivity implements SensorEventListener {
    static final String EXTRA_FOTO = "foto";
    static final String EXTRA_MASSIMO = "massimo";
    static final int RISULTATO_SISTEMA = RESULT_FIRST_USER + 1;

    private static final int AMBRA = 0xFFF59E0B, BLU = 0xFF0F172A, BLU_CHIARO = 0xFF1E293B, VERDE = 0xFF34D399;

    private PreviewView anteprima;
    private ImageCapture scatto;
    private Camera camera;
    private final ArrayList<String> foto = new ArrayList<>();
    private ExecutorService lavoro;
    private ImageView miniatura, iconaFlash;
    private TextView conta, fatto, testoFlash, sistema;
    private Griglia griglia;
    private Livella livella;
    private Fuoco fuoco;
    private Otturatore otturatore;
    private View lampo;
    private LinearLayout rigaZoom;
    private boolean inCorso = false;
    private int modoFlash = ImageCapture.FLASH_MODE_AUTO, massimo, rotazioneSuperficie = Surface.ROTATION_0;
    private SensorManager sensori;
    private OrientationEventListener orientamento;
    private final List<View> ruotabili = new ArrayList<>();
    private SharedPreferences pref;
    private ProcessCameraProvider fornitore;
    private Preview vistaPrevia;
    /**
     * Un pulsante dello zoom: rapporto rispetto all'obiettivo principale e come raggiungerlo:
     *  camera = fotocamera separata da aprire; fisica = obiettivo interno alla principale da aprire direttamente;
     *  entrambi null = zoom continuo della principale.
     */
    private static final class Obiettivo { final float rapporto; final String camera, fisica; final boolean ottico, nascosta;
        Obiettivo(float r, String c, String f, boolean o) { this(r, c, f, o, false); }
        Obiettivo(float r, String c, String f, boolean o, boolean n) { rapporto = r; camera = c; fisica = f; ottico = o; nascosta = n; }
        boolean diretto() { return camera != null || fisica != null; } }
    // obiettivo nascosto dal produttore, aperto con Camera2 (CameraX non lo vede): anteprima su una TextureView
    private TextureView vistaNascosta;
    private ObiettivoNascosto nascosto;
    private final List<Obiettivo> obiettivi = new ArrayList<>();
    private Obiettivo attivo = null;
    private String principale = null, cameraAttiva = null;
    private float zoomAttivo = 1f;
    // HDR: estensione del produttore (la migliore) oppure «scena HDR» di Camera2; formato della foto
    private ExtensionsManager estensioni;
    private boolean hdrAcceso, hdrEstensione, hdrConEstensione;
    private String formato = "4:3";
    private LinearLayout bHdr, bFormato;
    private TextView testoHdr, testoFormato;
    private final StringBuilder diagnosi = new StringBuilder();

    private int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    @Override
    protected void onCreate(Bundle stato) {
        super.onCreate(stato);
        massimo = Math.max(1, getIntent().getIntExtra(EXTRA_MASSIMO, 30));
        lavoro = Executors.newSingleThreadExecutor();
        pref = getSharedPreferences("doctorwood_fotocamera", Context.MODE_PRIVATE);
        modoFlash = pref.getInt("flash", ImageCapture.FLASH_MODE_AUTO);
        hdrAcceso = pref.getBoolean("hdr", false);
        formato = pref.getString("formato", "4:3");
        if (!"16:9".equals(formato) && !"1:1".equals(formato)) formato = "4:3";

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        ic.setAppearanceLightStatusBars(false);
        ic.setAppearanceLightNavigationBars(false);

        setContentView(costruisci());
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { chiudi(); }
        });
        avviaCamera();
    }

    // ===================== interfaccia =====================

    private View costruisci() {
        FrameLayout radice = new FrameLayout(this);
        radice.setBackgroundColor(Color.BLACK);

        anteprima = new PreviewView(this);
        anteprima.setScaleType(PreviewView.ScaleType.FIT_CENTER);   // si vede tutta la foto che verrà scattata
        anteprima.setBackgroundColor(Color.BLACK);
        radice.addView(anteprima, new FrameLayout.LayoutParams(-1, -1));
        vistaNascosta = new TextureView(this);
        vistaNascosta.setVisibility(View.GONE);
        radice.addView(vistaNascosta, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));

        griglia = new Griglia(this);
        griglia.linee(pref.getBoolean("griglia", true));
        griglia.formato(formato);
        radice.addView(griglia, new FrameLayout.LayoutParams(-1, -1));
        livella = new Livella(this);
        radice.addView(livella, new FrameLayout.LayoutParams(-1, -1));
        fuoco = new Fuoco(this);
        radice.addView(fuoco, new FrameLayout.LayoutParams(-1, -1));
        lampo = new View(this);
        lampo.setBackgroundColor(Color.WHITE);
        lampo.setAlpha(0f);
        radice.addView(lampo, new FrameLayout.LayoutParams(-1, -1));

        // ---- barra in alto: chiudi · HDR · formato · griglia · flash ----
        FrameLayout alto = new FrameLayout(this);
        GradientDrawable sfumaAlto = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { 0xAA000000, 0x00000000 });
        alto.setBackground(sfumaAlto);
        alto.setPadding(dp(12), dp(8), dp(12), dp(24));
        View chiudi = pulsanteIcona(R.drawable.ic_cam_chiudi, null, "Chiudi", v -> chiudi());
        alto.addView(chiudi, new FrameLayout.LayoutParams(-2, -2, Gravity.START | Gravity.CENTER_VERTICAL));
        LinearLayout destra = new LinearLayout(this);
        destra.setOrientation(LinearLayout.HORIZONTAL);
        bHdr = pulsanteIcona(R.drawable.ic_cam_hdr, "HDR", "HDR", v -> cambiaHdr());
        testoHdr = (TextView) bHdr.getChildAt(1);
        bHdr.setVisibility(View.GONE);   // compare solo se il telefono lo offre
        destra.addView(bHdr);
        bFormato = pulsanteIcona(R.drawable.ic_cam_formato, formato, "Formato della foto", v -> cambiaFormato());
        testoFormato = (TextView) bFormato.getChildAt(1);
        destra.addView(bFormato);
        LinearLayout bGriglia = pulsanteIcona(R.drawable.ic_cam_griglia, "Griglia", "Griglia", v -> {
            boolean si = !griglia.conLinee();
            griglia.linee(si);
            pref.edit().putBoolean("griglia", si).apply();
            v.setAlpha(si ? 1f : 0.55f);
        });
        bGriglia.setAlpha(griglia.conLinee() ? 1f : 0.55f);
        destra.addView(bGriglia);
        LinearLayout bFlash = pulsanteIcona(R.drawable.ic_cam_flash, "Auto", "Flash", v -> cambiaFlash());
        iconaFlash = (ImageView) bFlash.getChildAt(0);
        testoFlash = (TextView) bFlash.getChildAt(1);
        destra.addView(bFlash);
        alto.addView(destra, new FrameLayout.LayoutParams(-2, -2, Gravity.END | Gravity.CENTER_VERTICAL));
        radice.addView(alto, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
        mostraFlash();

        // ---- in basso: zoom · miniatura / scatto / fatto · fotocamera del telefono ----
        LinearLayout basso = new LinearLayout(this);
        basso.setOrientation(LinearLayout.VERTICAL);
        basso.setGravity(Gravity.CENTER_HORIZONTAL);
        basso.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, new int[] { 0xE60F172A, 0x000F172A }));
        basso.setPadding(dp(16), dp(28), dp(16), dp(12));

        rigaZoom = new LinearLayout(this);
        rigaZoom.setOrientation(LinearLayout.HORIZONTAL);
        rigaZoom.setGravity(Gravity.CENTER);
        GradientDrawable fondoZoom = new GradientDrawable();
        fondoZoom.setColor(0x660F172A);
        fondoZoom.setCornerRadius(dp(20));
        rigaZoom.setBackground(fondoZoom);
        rigaZoom.setPadding(dp(4), dp(4), dp(4), dp(4));
        rigaZoom.setOnLongClickListener(v -> { mostraDiagnosi(); return true; });
        LinearLayout.LayoutParams lpZoom = new LinearLayout.LayoutParams(-2, -2);
        lpZoom.bottomMargin = dp(18);
        basso.addView(rigaZoom, lpZoom);

        FrameLayout comandi = new FrameLayout(this);
        // miniatura con il numero di foto
        FrameLayout boxMini = new FrameLayout(this);
        miniatura = new ImageView(this);
        miniatura.setScaleType(ImageView.ScaleType.CENTER_CROP);
        GradientDrawable fondoMini = new GradientDrawable();
        fondoMini.setColor(BLU_CHIARO);
        fondoMini.setCornerRadius(dp(12));
        fondoMini.setStroke(dp(2), 0x55FFFFFF);
        miniatura.setBackground(fondoMini);
        miniatura.setClipToOutline(true);
        miniatura.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View v, Outline o) { o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), dp(12)); }
        });
        boxMini.addView(miniatura, new FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER));
        conta = new TextView(this);
        conta.setTextColor(BLU);
        conta.setTextSize(12);
        conta.setTypeface(conta.getTypeface(), android.graphics.Typeface.BOLD);
        conta.setGravity(Gravity.CENTER);
        GradientDrawable fondoConta = new GradientDrawable();
        fondoConta.setColor(AMBRA);
        fondoConta.setCornerRadius(dp(11));
        conta.setBackground(fondoConta);
        conta.setMinWidth(dp(22));
        conta.setPadding(dp(5), 0, dp(5), 0);
        conta.setVisibility(View.GONE);
        boxMini.addView(conta, new FrameLayout.LayoutParams(-2, dp(22), Gravity.TOP | Gravity.END));
        boxMini.setPadding(0, dp(4), dp(4), 0);
        boxMini.setContentDescription("Foto scattate");
        ruotabili.add(boxMini);
        comandi.addView(boxMini, new FrameLayout.LayoutParams(dp(68), dp(68), Gravity.START | Gravity.CENTER_VERTICAL));

        otturatore = new Otturatore(this);
        otturatore.setContentDescription("Scatta");
        otturatore.setOnClickListener(v -> scatta());
        comandi.addView(otturatore, new FrameLayout.LayoutParams(dp(82), dp(82), Gravity.CENTER));

        fatto = new TextView(this);
        fatto.setText("Fatto");
        fatto.setTextColor(BLU);
        fatto.setTextSize(16);
        fatto.setTypeface(fatto.getTypeface(), android.graphics.Typeface.BOLD);
        fatto.setGravity(Gravity.CENTER);
        GradientDrawable fondoFatto = new GradientDrawable();
        fondoFatto.setColor(AMBRA);
        fondoFatto.setCornerRadius(dp(24));
        fatto.setBackground(fondoFatto);
        fatto.setPadding(dp(20), 0, dp(20), 0);
        fatto.setOnClickListener(v -> consegna());
        fatto.setEnabled(false);
        fatto.setAlpha(0.35f);
        ruotabili.add(fatto);
        comandi.addView(fatto, new FrameLayout.LayoutParams(-2, dp(48), Gravity.END | Gravity.CENTER_VERTICAL));
        basso.addView(comandi, new LinearLayout.LayoutParams(-1, dp(88)));

        sistema = new TextView(this);
        sistema.setText("Usa la fotocamera del telefono");
        sistema.setTextColor(0xFFCBD5E1);
        sistema.setTextSize(13);
        sistema.setGravity(Gravity.CENTER);
        sistema.setPadding(dp(12), dp(10), dp(12), dp(6));
        sistema.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_cam_telefono, 0, 0, 0);
        sistema.setCompoundDrawablePadding(dp(8));
        sistema.setOnClickListener(v -> { setResult(RISULTATO_SISTEMA); finish(); });
        basso.addView(sistema, new LinearLayout.LayoutParams(-2, dp(44)));
        radice.addView(basso, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));

        // margini di sistema (barra di stato, gesti)
        ViewCompat.setOnApplyWindowInsetsListener(radice, (v, ins) -> {
            Insets s = ins.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            alto.setPadding(dp(12) + s.left, dp(8) + s.top, dp(12) + s.right, dp(24));
            basso.setPadding(dp(16) + s.left, dp(28), dp(16) + s.right, dp(12) + s.bottom);
            griglia.margini(s.top + dp(64), s.bottom + dp(170));
            return ins;
        });

        gestiAnteprima();
        return radice;
    }

    private LinearLayout pulsanteIcona(int icona, String etichetta, String descrizione, View.OnClickListener azione) {
        LinearLayout b = new LinearLayout(this);
        b.setOrientation(LinearLayout.VERTICAL);
        b.setGravity(Gravity.CENTER);
        b.setMinimumWidth(dp(52));
        b.setMinimumHeight(dp(52));
        b.setPadding(dp(8), dp(6), dp(8), dp(6));
        b.setContentDescription(descrizione);
        ImageView i = new ImageView(this);
        i.setImageResource(icona);
        b.addView(i, new LinearLayout.LayoutParams(dp(26), dp(26)));
        if (etichetta != null) {
            TextView t = new TextView(this);
            t.setText(etichetta);
            t.setTextColor(Color.WHITE);
            t.setTextSize(11);
            t.setGravity(Gravity.CENTER);
            b.addView(t);
        }
        b.setOnClickListener(azione);
        ruotabili.add(b);
        return b;
    }

    private void cambiaFlash() {
        modoFlash = modoFlash == ImageCapture.FLASH_MODE_AUTO ? ImageCapture.FLASH_MODE_ON
                : modoFlash == ImageCapture.FLASH_MODE_ON ? ImageCapture.FLASH_MODE_OFF : ImageCapture.FLASH_MODE_AUTO;
        pref.edit().putInt("flash", modoFlash).apply();
        if (scatto != null) scatto.setFlashMode(modoFlash);
        if (nascosto != null) nascosto.flash(modoFlash);
        mostraFlash();
    }

    private void mostraFlash() {
        if (iconaFlash == null) return;
        iconaFlash.setImageResource(modoFlash == ImageCapture.FLASH_MODE_OFF ? R.drawable.ic_cam_flash_no : R.drawable.ic_cam_flash);
        testoFlash.setText(modoFlash == ImageCapture.FLASH_MODE_AUTO ? "Auto" : modoFlash == ImageCapture.FLASH_MODE_ON ? "Sì" : "No");
    }

    private void costruisciZoom() {
        for (int i = 0; i < rigaZoom.getChildCount(); i++) ruotabili.remove(rigaZoom.getChildAt(i));
        rigaZoom.removeAllViews();
        rigaZoom.setVisibility(View.VISIBLE);   // anche con un solo obiettivo: tenendolo premuto si vede cosa offre il telefono
        for (Obiettivo o : obiettivi) {
            TextView t = new TextView(this);
            float l = o.rapporto;
            t.setText(etichetta(l));
            t.setTextSize(13);
            t.setGravity(Gravity.CENTER);
            t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
            t.setTag(o);
            t.setContentDescription(l < 1f ? "Grandangolo" : l > 1.05f ? (o.ottico ? "Teleobiettivo" : "Zoom digitale") : "Obiettivo principale");
            t.setOnClickListener(v -> scegliObiettivo((Obiettivo) v.getTag()));
            t.setOnLongClickListener(v -> { mostraDiagnosi(); return true; });
            rigaZoom.addView(t, new LinearLayout.LayoutParams(dp(48), dp(36)));
            ruotabili.add(t);
        }
        evidenziaZoom(attivo != null && attivo.diretto() ? attivo.rapporto : zoomAttivo);
    }

    private void scegliObiettivo(Obiettivo o) {
        if (camera == null || fornitore == null) return;
        Obiettivo prima = attivo;
        if (o.nascosta) { if (o != attivo) apriNascosta(o, nascosto != null ? principaleUno() : prima); return; }
        boolean cambia = o.diretto() || (attivo != null && attivo.diretto());
        if (nascosto != null) { chiudiNascosta(); cambia = true; prima = principaleUno(); }
        try {
            if (cambia) lega(o, o.diretto() ? 1f : o.rapporto);   // obiettivo da aprire (o ritorno al principale)
            else camera.getCameraControl().setZoomRatio(o.rapporto);
            attivo = o;
            zoomAttivo = o.rapporto;
            evidenziaZoom(o.rapporto);
            aggiornaHdr();
        } catch (Exception e) {
            // il telefono non lo lascia aprire: lo si toglie e si torna all'obiettivo di prima
            obiettivi.remove(o);
            diagnosi.append("\nApertura di ").append(etichetta(o.rapporto)).append(" non riuscita: ").append(e.getMessage());
            try { lega(prima, prima != null && prima.diretto() ? 1f : zoomAttivo); } catch (Exception ignored) { }
            costruisciZoom();
            aggiornaHdr();
            Toast.makeText(this, "Questo obiettivo non è disponibile per le app", Toast.LENGTH_SHORT).show();
        }
    }

    /** Il pulsante 1× (la fotocamera principale con il suo zoom). */
    private Obiettivo principaleUno() {
        for (Obiettivo o : obiettivi) if (!o.diretto() && Math.abs(o.rapporto - 1f) < 0.05f) return o;
        return obiettivi.isEmpty() ? null : obiettivi.get(0);
    }

    /**
     * Apre un obiettivo nascosto con Camera2. Se il telefono rifiuta, lo si toglie dai pulsanti
     * e si torna a «ritorno» (di solito 1×).
     */
    private void apriNascosta(Obiettivo o, Obiettivo ritorno) {
        chiudiNascosta();
        fornitore.unbindAll();
        // la vista dell'anteprima con le proporzioni della foto, al centro, come la PreviewView
        float alto = "16:9".equals(formato) ? 16f / 9f : 4f / 3f;
        int W = anteprima.getWidth(), H = anteprima.getHeight();
        int w = W, h = Math.round(W * alto);
        if (h > H) { h = H; w = Math.round(H / alto); }
        vistaNascosta.setLayoutParams(new FrameLayout.LayoutParams(w, h, Gravity.CENTER));
        vistaNascosta.setVisibility(View.VISIBLE);
        Runnable via = () -> {
            try {
                nascosto = new ObiettivoNascosto(this, o.camera, vistaNascosta);
            } catch (Exception e) {
                nascostaRifiutata(o, ritorno, e.getMessage());
                return;
            }
            final ObiettivoNascosto questo = nascosto;
            questo.apri("16:9".equals(formato), modoFlash, hdrAcceso, new ObiettivoNascosto.Esito() {
                @Override public void ok() {
                    if (nascosto != questo) return;
                    attivo = o;
                    cameraAttiva = o.camera;
                    zoomAttivo = o.rapporto;
                    anteprima.setVisibility(View.INVISIBLE);
                    boolean f = questo.haFlash();
                    iconaFlash.setVisibility(f ? View.VISIBLE : View.GONE);
                    testoFlash.setVisibility(f ? View.VISIBLE : View.GONE);
                    evidenziaZoom(o.rapporto);
                    aggiornaHdr();
                }
                @Override public void errore(String motivo) {
                    if (nascosto != questo) return;
                    nascostaRifiutata(o, ritorno, motivo);
                }
            });
        };
        if (vistaNascosta.isAvailable()) via.run();
        else vistaNascosta.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override public void onSurfaceTextureAvailable(@NonNull android.graphics.SurfaceTexture st, int a, int b) { vistaNascosta.setSurfaceTextureListener(null); via.run(); }
            @Override public void onSurfaceTextureSizeChanged(@NonNull android.graphics.SurfaceTexture st, int a, int b) { }
            @Override public boolean onSurfaceTextureDestroyed(@NonNull android.graphics.SurfaceTexture st) { return true; }
            @Override public void onSurfaceTextureUpdated(@NonNull android.graphics.SurfaceTexture st) { }
        });
    }

    private void nascostaRifiutata(Obiettivo o, Obiettivo ritorno, String motivo) {
        chiudiNascosta();
        obiettivi.remove(o);
        diagnosi.append("\nApertura di ").append(etichetta(o.rapporto)).append(" (nascosta ").append(o.camera).append(") non riuscita: ").append(motivo);
        Obiettivo r = ritorno != null && !ritorno.nascosta ? ritorno : principaleUno();
        try { lega(r, r != null && r.diretto() ? 1f : (r != null ? r.rapporto : 1f)); attivo = r; zoomAttivo = r != null ? r.rapporto : 1f; } catch (Exception ignored) { }
        costruisciZoom();
        aggiornaHdr();
        Toast.makeText(this, "Il telefono non lascia usare questo obiettivo alle app", Toast.LENGTH_LONG).show();
    }

    private void chiudiNascosta() {
        if (nascosto != null) { nascosto.chiudi(); nascosto = null; }
        vistaNascosta.setVisibility(View.GONE);
        anteprima.setVisibility(View.VISIBLE);
    }

    private static String etichetta(float l) {
        return (Math.abs(l - Math.round(l)) < 0.05f ? String.valueOf(Math.round(l)) : String.valueOf(l).replace('.', ',')) + "×";
    }

    /** L'obiettivo in uso è il principale (lì vale l'HDR del produttore)? */
    private boolean suPrincipale() { return attivo == null || !attivo.diretto(); }

    /** La fotocamera in uso offre la «scena HDR» di Camera2? */
    private boolean scenaHdr() {
        try {
            CameraManager cm = (CameraManager) getSystemService(CAMERA_SERVICE);
            int[] scene = cm.getCameraCharacteristics(cameraAttiva).get(CameraCharacteristics.CONTROL_AVAILABLE_SCENE_MODES);
            if (scene != null) for (int m : scene) if (m == CameraMetadata.CONTROL_SCENE_MODE_HDR) return true;
        } catch (Exception ignored) { }
        return false;
    }

    private void cambiaHdr() {
        hdrAcceso = !hdrAcceso;
        pref.edit().putBoolean("hdr", hdrAcceso).apply();
        if (suPrincipale() && hdrEstensione) rilega();   // l'estensione si attiva solo ricollegando la fotocamera
        else applicaScenaHdr();
        aggiornaHdr();
        Toast.makeText(this, hdrAcceso ? "HDR acceso" : "HDR spento", Toast.LENGTH_SHORT).show();
    }

    /** Senza estensione del produttore: chiede alla fotocamera la scena HDR (o la toglie). */
    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    private void applicaScenaHdr() {
        if (nascosto != null) { nascosto.hdr(hdrAcceso); return; }
        if (camera == null || hdrConEstensione) return;
        try {
            Camera2CameraControl c2 = Camera2CameraControl.from(camera.getCameraControl());
            if (hdrAcceso && scenaHdr()) {
                c2.setCaptureRequestOptions(new CaptureRequestOptions.Builder()
                        .setCaptureRequestOption(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_USE_SCENE_MODE)
                        .setCaptureRequestOption(CaptureRequest.CONTROL_SCENE_MODE, CameraMetadata.CONTROL_SCENE_MODE_HDR)
                        .build());
            } else {
                c2.clearCaptureRequestOptions();
            }
        } catch (Exception ignored) { }
    }

    /** Il pulsante HDR compare solo dove serve davvero a qualcosa. */
    private void aggiornaHdr() {
        if (bHdr == null) return;
        boolean c = (suPrincipale() && hdrEstensione) || scenaHdr();
        bHdr.setVisibility(c ? View.VISIBLE : View.GONE);
        testoHdr.setText(hdrAcceso ? "HDR sì" : "HDR no");
        bHdr.setAlpha(hdrAcceso ? 1f : 0.55f);
    }

    private void cambiaFormato() {
        formato = "4:3".equals(formato) ? "16:9" : "16:9".equals(formato) ? "1:1" : "4:3";
        pref.edit().putString("formato", formato).apply();
        testoFormato.setText(formato);
        griglia.formato(formato);
        rilega();
    }

    /** Ricollega la fotocamera con le scelte attuali, mantenendo obiettivo e zoom. */
    private void rilega() {
        if (fornitore == null || camera == null) return;
        if (nascosto != null && attivo != null && attivo.nascosta) { apriNascosta(attivo, principaleUno()); return; }
        float z = zoomAttivo;
        ZoomState s = camera.getCameraInfo().getZoomState().getValue();
        if (s != null && suPrincipale()) z = s.getZoomRatio();
        try { lega(attivo, attivo != null && attivo.diretto() ? 1f : z); }
        catch (Exception e) { Toast.makeText(this, "Fotocamera non disponibile", Toast.LENGTH_SHORT).show(); }
    }

    /** Cosa offre il telefono alle app: utile per capire perché un obiettivo manca. Si può copiare. */
    private void mostraDiagnosi() {
        String testo = diagnosi.toString().trim();
        if (testo.isEmpty()) testo = "Informazioni non ancora pronte.";
        final String copia = testo;
        TextView t = new TextView(this);
        t.setText(testo);
        t.setTextIsSelectable(true);
        t.setTextSize(12);
        t.setPadding(dp(20), dp(12), dp(20), dp(4));
        android.widget.ScrollView sv = new android.widget.ScrollView(this);
        sv.addView(t);
        new AlertDialog.Builder(this)
                .setTitle("Obiettivi del telefono")
                .setView(sv)
                .setPositiveButton("Chiudi", null)
                .setNeutralButton("Copia", (d, w) -> {
                    ClipboardManager cb = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (cb != null) cb.setPrimaryClip(ClipData.newPlainText("Obiettivi", copia));
                    Toast.makeText(this, "Copiato", Toast.LENGTH_SHORT).show();
                })
                .show();
    }

    private void evidenziaZoom(float attuale) {
        for (int i = 0; i < rigaZoom.getChildCount(); i++) {
            TextView t = (TextView) rigaZoom.getChildAt(i);
            boolean si = Math.abs(((Obiettivo) t.getTag()).rapporto - attuale) < 0.08f;
            GradientDrawable g = new GradientDrawable();
            g.setColor(si ? 0xFF1E293B : 0x00000000);
            g.setCornerRadius(dp(18));
            t.setBackground(g);
            t.setTextColor(si ? AMBRA : Color.WHITE);
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private void gestiAnteprima() {
        ScaleGestureDetector pizzico = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(@NonNull ScaleGestureDetector d) {
                if (nascosto != null) {
                    nascosto.zoom(nascosto.zoom() * d.getScaleFactor());
                    evidenziaZoom(attivo.rapporto * nascosto.zoom());
                    return true;
                }
                if (camera == null) return false;
                ZoomState z = camera.getCameraInfo().getZoomState().getValue();
                if (z == null) return false;
                float nuovo = Math.max(z.getMinZoomRatio(), Math.min(z.getMaxZoomRatio(), z.getZoomRatio() * d.getScaleFactor()));
                camera.getCameraControl().setZoomRatio(nuovo);
                float base = attivo != null && attivo.diretto() ? attivo.rapporto : 1f;
                if (base == 1f) zoomAttivo = nuovo;
                evidenziaZoom(base * nuovo);
                return true;
            }
        });
        final float[] giu = new float[3];
        View.OnTouchListener tocco = (v, e) -> {
            pizzico.onTouchEvent(e);
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) { giu[0] = e.getX(); giu[1] = e.getY(); giu[2] = e.getPointerCount(); }
            if (e.getActionMasked() == MotionEvent.ACTION_POINTER_DOWN) giu[2] = 2;
            if (e.getActionMasked() == MotionEvent.ACTION_UP && giu[2] < 2 && Math.hypot(e.getX() - giu[0], e.getY() - giu[1]) < dp(12) && nascosto == null) mettiAFuoco(e.getX(), e.getY());
            return true;
        };
        anteprima.setOnTouchListener(tocco);
        vistaNascosta.setOnTouchListener(tocco);
    }

    private void mettiAFuoco(float x, float y) {
        if (camera == null) return;
        MeteringPoint p = anteprima.getMeteringPointFactory().createPoint(x, y);
        FocusMeteringAction a = new FocusMeteringAction.Builder(p, FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE)
                .setAutoCancelDuration(4, TimeUnit.SECONDS).build();
        camera.getCameraControl().startFocusAndMetering(a);
        fuoco.mostra(x, y);
    }

    // ===================== fotocamera =====================

    private void avviaCamera() {
        ListenableFuture<ProcessCameraProvider> futuro = ProcessCameraProvider.getInstance(this);
        futuro.addListener(() -> {
            try {
                fornitore = futuro.get();
            } catch (Exception e) {
                nonDisponibile();
                return;
            }
            // prima si chiede al telefono se ha l'HDR del produttore, poi si accende la fotocamera
            ListenableFuture<ExtensionsManager> fe = ExtensionsManager.getInstanceAsync(this, fornitore);
            fe.addListener(() -> {
                try {
                    estensioni = fe.get();
                    hdrEstensione = estensioni.isExtensionAvailable(CameraSelector.DEFAULT_BACK_CAMERA, ExtensionMode.HDR);
                } catch (Exception ignored) { estensioni = null; hdrEstensione = false; }
                try {
                    lega(null, 1f);
                    analizzaObiettivi();
                    costruisciZoom();
                    aggiornaHdr();
                } catch (Exception e) {
                    nonDisponibile();
                }
            }, ContextCompat.getMainExecutor(this));
        }, ContextCompat.getMainExecutor(this));
    }

    /** Nessuna fotocamera utilizzabile qui: si passa a quella del telefono. */
    private void nonDisponibile() {
        Toast.makeText(this, "Fotocamera non disponibile: apro quella del telefono", Toast.LENGTH_LONG).show();
        setResult(RISULTATO_SISTEMA);
        finish();
    }

    /**
     * Lega anteprima e scatto all'obiettivo indicato (null = principale) con lo zoom indicato,
     * nel formato scelto e, sul principale, con l'HDR del produttore se acceso.
     */
    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    private void lega(Obiettivo o, float zoom) {
        AspectRatioStrategy proporzioni = "16:9".equals(formato)
                ? AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY : AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY;
        ResolutionSelector perAnteprima = new ResolutionSelector.Builder().setAspectRatioStrategy(proporzioni).build();
        ResolutionSelector perScatto = new ResolutionSelector.Builder().setAspectRatioStrategy(proporzioni)
                .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY).build();
        vistaPrevia = new Preview.Builder().setResolutionSelector(perAnteprima).build();
        vistaPrevia.setSurfaceProvider(anteprima.getSurfaceProvider());
        scatto = new ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .setResolutionSelector(perScatto)
                .setFlashMode(modoFlash)
                .setTargetRotation(rotazioneSuperficie)
                .build();
        CameraSelector sel;
        boolean conEstensione = false;
        if (o != null && o.camera != null) {
            sel = soloCamera(o.camera).build();                                    // fotocamera separata
        } else if (o != null && o.fisica != null) {
            sel = soloCamera(principale).setPhysicalCameraId(o.fisica).build();   // obiettivo interno alla principale
        } else if (hdrAcceso && hdrEstensione && estensioni != null) {
            sel = estensioni.getExtensionEnabledCameraSelector(CameraSelector.DEFAULT_BACK_CAMERA, ExtensionMode.HDR);
            conEstensione = true;
        } else {
            sel = CameraSelector.DEFAULT_BACK_CAMERA;
        }
        fornitore.unbindAll();
        try {
            camera = fornitore.bindToLifecycle(this, sel, vistaPrevia, scatto);
        } catch (RuntimeException e) {
            if (!conEstensione) throw e;
            // l'HDR del produttore non parte su questo telefono: si continua senza
            hdrEstensione = false;
            conEstensione = false;
            diagnosi.append("\nHDR del produttore non avviato: ").append(e.getMessage());
            fornitore.unbindAll();
            camera = fornitore.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, vistaPrevia, scatto);
        }
        hdrConEstensione = conEstensione;
        try { cameraAttiva = Camera2CameraInfo.from(camera.getCameraInfo()).getCameraId(); }
        catch (Exception e) { if (cameraAttiva == null) cameraAttiva = principale; }
        if (principale == null) principale = cameraAttiva;
        boolean flash = camera.getCameraInfo().hasFlashUnit();
        iconaFlash.setVisibility(flash ? View.VISIBLE : View.GONE);
        testoFlash.setVisibility(flash ? View.VISIBLE : View.GONE);
        if (zoom != 1f) camera.getCameraControl().setZoomRatio(zoom);
        applicaScenaHdr();
    }

    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    private static CameraSelector.Builder soloCamera(String id) {
        return new CameraSelector.Builder().addCameraFilter(infos -> {
            List<CameraInfo> l = new ArrayList<>();
            for (CameraInfo i : infos) if (id.equals(Camera2CameraInfo.from(i).getCameraId())) l.add(i);
            return l;
        });
    }

    /** Lunghezza focale equivalente (35 mm) di una fotocamera: serve a confrontare gli obiettivi tra loro. */
    private static float equivalente(CameraCharacteristics c) {
        float[] f = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
        SizeF s = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
        if (f == null || f.length == 0 || s == null || s.getWidth() <= 0) return 0f;
        return (float) (f[0] * 43.27 / Math.hypot(s.getWidth(), s.getHeight()));
    }

    /**
     * Gli obiettivi posteriori del telefono, come pulsanti dello zoom:
     *  - quelli dentro la fotocamera «logica» principale: con lo zoom continuo se ci rientrano, altrimenti aprendoli
     *    direttamente (succede su vari Motorola: il grandangolo c'è ma lo zoom non scende sotto 1×);
     *  - quelli esposti come fotocamere separate: si raggiungono cambiando fotocamera.
     * Alcuni produttori nascondono gli altri obiettivi alle app: allora restano 1× e lo zoom digitale.
     * Intanto si scrive una diagnosi (tenere premuta la fila dello zoom) per capire cosa offre il telefono.
     */
    @OptIn(markerClass = ExperimentalCamera2Interop.class)
    private void analizzaObiettivi() {
        obiettivi.clear();
        diagnosi.setLength(0);
        Obiettivo uno = new Obiettivo(1f, null, null, true);
        obiettivi.add(uno);
        attivo = uno;
        ZoomState z = camera.getCameraInfo().getZoomState().getValue();
        float min = z != null ? z.getMinZoomRatio() : 1f, max = z != null ? z.getMaxZoomRatio() : 1f;
        diagnosi.append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append(" · Android ").append(Build.VERSION.RELEASE)
                .append("\nPrincipale: ").append(principale).append(" · zoom ").append(min).append("–").append(max).append('\n');
        try {
            CameraManager cm = (CameraManager) getSystemService(CAMERA_SERVICE);
            CameraCharacteristics cp = cm.getCameraCharacteristics(principale);
            float eqP = equivalente(cp);
            String[] elenco = cm.getCameraIdList();
            diagnosi.append("\nFotocamere dichiarate:\n");
            for (String id : elenco) diagnosi.append(descrivi(cm, id)).append('\n');
            Set<String> fisiche = cp.getPhysicalCameraIds();
            if (!fisiche.isEmpty()) {
                diagnosi.append("\nObiettivi dentro la principale:\n");
                for (String id : fisiche) diagnosi.append(descrivi(cm, id)).append('\n');
            }
            if (eqP > 0) {
                // obiettivi della fotocamera logica
                for (String id : fisiche) {
                    float r = Math.round(equivalente(cm.getCameraCharacteristics(id)) / eqP * 10f) / 10f;
                    if (r <= 0 || Math.abs(r - 1f) <= 0.15f) continue;
                    if (r >= min - 0.05f && r <= max + 0.05f) aggiungiObiettivo(Math.max(min, Math.min(max, r)), null, null, true);
                    else aggiungiObiettivo(r, null, id, true);   // fuori dallo zoom: si apre direttamente
                }
                // obiettivi esposti come fotocamere separate
                Set<String> visti = new HashSet<>(fisiche);
                visti.add(principale);
                StringBuilder cx = new StringBuilder();
                for (CameraInfo info : fornitore.getAvailableCameraInfos()) {
                    String id = Camera2CameraInfo.from(info).getCameraId();
                    cx.append(id).append(' ');
                    if (info.getLensFacing() != CameraSelector.LENS_FACING_BACK || visti.contains(id)) continue;
                    float r = Math.round(equivalente(cm.getCameraCharacteristics(id)) / eqP * 10f) / 10f;
                    if (r > 0 && Math.abs(r - 1f) > 0.15f) aggiungiObiettivo(r, id, null, true);
                }
                diagnosi.append("\nUtilizzabili dalle app (CameraX): ").append(cx.toString().trim()).append('\n');
            }
            // fotocamere che il telefono non dichiara: le app non possono usarle, ma è utile saperlo
            Set<String> dichiarate = new HashSet<>(Arrays.asList(elenco));
            dichiarate.addAll(fisiche);
            StringBuilder nascoste = new StringBuilder();
            for (int i = 0; i < 16; i++) {
                String id = String.valueOf(i);
                if (dichiarate.contains(id)) continue;
                try {
                    CameraCharacteristics c = cm.getCameraCharacteristics(id);
                    nascoste.append(descrivi(cm, id)).append('\n');
                    // posteriore, non «logica»: si prova ad aprirla con Camera2
                    Integer verso = c.get(CameraCharacteristics.LENS_FACING);
                    boolean logica = !c.getPhysicalCameraIds().isEmpty();
                    if (verso != null && verso == CameraCharacteristics.LENS_FACING_BACK && !logica && eqP > 0) {
                        float r = Math.round(equivalente(c) / eqP * 10f) / 10f;
                        if (r > 0 && Math.abs(r - 1f) > 0.15f) aggiungiObiettivo(r, id, null, true, true);
                    }
                } catch (Exception ignored) { }
            }
            if (nascoste.length() > 0) diagnosi.append("\nNascoste alle app:\n").append(nascoste);
        } catch (Exception e) {
            diagnosi.append("\nErrore nella lettura: ").append(e.getMessage());
        }
        // grandangolo raggiungibile con lo zoom anche se il telefono non dice quale obiettivo è
        if (min <= 0.7f) aggiungiObiettivo(Math.round(min * 10f) / 10f, null, null, true);
        // senza tele: un 2× digitale, comodo per leggere le quote da lontano
        boolean tele = false;
        for (Obiettivo o : obiettivi) if (o.rapporto >= 1.8f) tele = true;
        if (!tele && max >= 2f) aggiungiObiettivo(2f, null, null, false);
        Collections.sort(obiettivi, (a, b) -> Float.compare(a.rapporto, b.rapporto));
        diagnosi.append("\nHDR del produttore: ").append(hdrEstensione ? "sì" : "no")
                .append(" · scena HDR: ").append(scenaHdr() ? "sì" : "no")
                .append("\nPulsanti: ");
        for (Obiettivo o : obiettivi) diagnosi.append(etichetta(o.rapporto)).append(o.fisica != null ? " (interno " + o.fisica + ")" : o.nascosta ? " (nascosta " + o.camera + ", Camera2)" : o.camera != null ? " (camera " + o.camera + ")" : "").append("  ");
    }

    /** Una riga della diagnosi: id, verso, focale equivalente, se è logica. */
    private static String descrivi(CameraManager cm, String id) {
        try {
            CameraCharacteristics c = cm.getCameraCharacteristics(id);
            Integer v = c.get(CameraCharacteristics.LENS_FACING);
            String verso = v == null ? "?" : v == CameraCharacteristics.LENS_FACING_BACK ? "posteriore" : v == CameraCharacteristics.LENS_FACING_FRONT ? "anteriore" : "esterna";
            String riga = "• " + id + ": " + verso + ", " + Math.round(equivalente(c)) + " mm equiv.";
            if (!c.getPhysicalCameraIds().isEmpty()) riga += ", logica " + c.getPhysicalCameraIds();
            return riga;
        } catch (Exception e) {
            return "• " + id + ": illeggibile";
        }
    }

    private void aggiungiObiettivo(float r, String camera, String fisica, boolean ottico) { aggiungiObiettivo(r, camera, fisica, ottico, false); }

    private void aggiungiObiettivo(float r, String camera, String fisica, boolean ottico, boolean nascosta) {
        for (Obiettivo o : obiettivi) if (Math.abs(o.rapporto - r) < 0.15f) return;   // già presente
        obiettivi.add(new Obiettivo(r, camera, fisica, ottico, nascosta));
    }

    private void scatta() {
        if ((scatto == null && nascosto == null) || inCorso) return;
        if (foto.size() >= massimo) { Toast.makeText(this, "Al massimo " + massimo + " foto per volta", Toast.LENGTH_SHORT).show(); return; }
        inCorso = true;
        otturatore.setOccupato(true);
        otturatore.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
        lampo.animate().cancel();
        lampo.setAlpha(0.7f);
        lampo.animate().alpha(0f).setDuration(260).start();
        File cartella = new File(getCacheDir(), "scatti");
        //noinspection ResultOfMethodCallIgnored
        cartella.mkdirs();
        long ora = System.currentTimeMillis();
        File grezza = new File(cartella, "grezza_" + ora + ".jpg"), pronta = new File(cartella, "foto_" + ora + ".jpg");
        final boolean quadrata = "1:1".equals(formato);
        if (nascosto != null) {
            int gradi = rotazioneSuperficie == Surface.ROTATION_270 ? 90 : rotazioneSuperficie == Surface.ROTATION_90 ? 270
                    : rotazioneSuperficie == Surface.ROTATION_180 ? 180 : 0;
            nascosto.scatta(gradi, grezza, new ObiettivoNascosto.Salvata() {
                @Override public void ok(File f) { lavoro.execute(() -> elabora(grezza, pronta, quadrata)); }
                @Override public void errore(String motivo) { FotocameraActivity.this.errore("Scatto non riuscito: " + motivo); }
            });
            return;
        }
        scatto.setTargetRotation(rotazioneSuperficie);
        scatto.takePicture(new ImageCapture.OutputFileOptions.Builder(grezza).build(), lavoro, new ImageCapture.OnImageSavedCallback() {
            @Override public void onImageSaved(@NonNull ImageCapture.OutputFileResults r) { elabora(grezza, pronta, quadrata); }
            @Override public void onError(@NonNull ImageCaptureException e) {
                runOnUiThread(() -> errore("Scatto non riuscito: " + e.getMessage()));
            }
        });
    }

    /** Riduce e raddrizza la foto grezza (in sottofondo), poi la mostra nella miniatura. */
    private void elabora(File grezza, File pronta, boolean quadrata) {
        try {
            FotoUtil.prepara(grezza, pronta, quadrata);
            //noinspection ResultOfMethodCallIgnored
            grezza.delete();
            android.graphics.Bitmap mini = FotoUtil.miniatura(pronta, dp(56));
            runOnUiThread(() -> aggiunta(pronta.getAbsolutePath(), mini));
        } catch (Exception e) {
            runOnUiThread(() -> errore("Foto non salvata: " + e.getMessage()));
        }
    }

    private void aggiunta(String percorso, android.graphics.Bitmap mini) {
        foto.add(percorso);
        if (mini != null) miniatura.setImageBitmap(mini);
        conta.setText(String.valueOf(foto.size()));
        conta.setVisibility(View.VISIBLE);
        fatto.setEnabled(true);
        fatto.setAlpha(1f);
        sistema.setVisibility(View.GONE);   // con foto già fatte qui si continua qui
        miniatura.setScaleX(0.6f); miniatura.setScaleY(0.6f);
        miniatura.animate().scaleX(1f).scaleY(1f).setDuration(220).start();
        inCorso = false;
        otturatore.setOccupato(false);
    }

    private void errore(String msg) {
        inCorso = false;
        otturatore.setOccupato(false);
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    private void consegna() {
        if (foto.isEmpty()) return;
        setResult(RESULT_OK, new Intent().putExtra(EXTRA_FOTO, foto.toArray(new String[0])));
        finish();
    }

    private void chiudi() {
        if (foto.isEmpty()) { setResult(RESULT_CANCELED); finish(); return; }
        new AlertDialog.Builder(this)
                .setTitle(foto.size() == 1 ? "Hai scattato 1 foto" : "Hai scattato " + foto.size() + " foto")
                .setMessage("Vuoi aggiungerle al rilievo o scartarle?")
                .setPositiveButton("Aggiungi", (d, w) -> consegna())
                .setNegativeButton("Scarta", (d, w) -> {
                    for (String f : foto) //noinspection ResultOfMethodCallIgnored
                        new File(f).delete();
                    setResult(RESULT_CANCELED);
                    finish();
                })
                .setNeutralButton("Continua", null)
                .show();
    }

    // ===================== orientamento e livella =====================

    @Override
    protected void onResume() {
        super.onResume();
        sensori = (SensorManager) getSystemService(SENSOR_SERVICE);
        Sensor g = sensori.getDefaultSensor(Sensor.TYPE_GRAVITY);
        if (g == null) g = sensori.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (g != null) sensori.registerListener(this, g, SensorManager.SENSOR_DELAY_UI);
        if (orientamento == null) {
            orientamento = new OrientationEventListener(this) {
                @Override public void onOrientationChanged(int gradi) {
                    if (gradi == ORIENTATION_UNKNOWN) return;
                    int r = gradi >= 45 && gradi < 135 ? Surface.ROTATION_270 : gradi >= 135 && gradi < 225 ? Surface.ROTATION_180
                            : gradi >= 225 && gradi < 315 ? Surface.ROTATION_90 : Surface.ROTATION_0;
                    if (r == rotazioneSuperficie) return;
                    rotazioneSuperficie = r;
                    if (scatto != null) scatto.setTargetRotation(r);
                    float ui = r == Surface.ROTATION_90 ? 90 : r == Surface.ROTATION_270 ? -90 : r == Surface.ROTATION_180 ? 180 : 0;
                    for (View v : ruotabili) v.animate().rotation(ui).setDuration(250).start();   // le icone restano dritte
                }
            };
        }
        if (orientamento.canDetectOrientation()) orientamento.enable();
        // tornando nell'app con il grandangolo nascosto scelto: lo si riapre
        if (attivo != null && attivo.nascosta && nascosto == null && fornitore != null) apriNascosta(attivo, principaleUno());
    }

    /** Lasciare la fotocamera (tasto Home, app recenti, schermo spento) è uscire dall'app: la fotocamera si chiude e, al ritorno, l'app chiede l'impronta. */
    @Override
    protected void onStop() {
        super.onStop();
        if (!isFinishing() && !isChangingConfigurations()) {
            setResult(RESULT_CANCELED, new Intent().putExtra("uscita", true));
            finish();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (sensori != null) sensori.unregisterListener(this);
        if (orientamento != null) orientamento.disable();
        if (nascosto != null) { nascosto.chiudi(); nascosto = null; }   // la fotocamera si libera subito
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (nascosto != null) { nascosto.chiudi(); nascosto = null; }
        lavoro.shutdown();
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        float x = e.values[0], y = e.values[1], z = e.values[2];
        float angolo = (float) Math.toDegrees(Math.atan2(x, y));
        boolean piatto = Math.abs(z) > 7.5f;   // telefono steso (foto verso il pavimento): la livella non serve
        livella.imposta(angolo, piatto);
    }

    @Override public void onAccuracyChanged(Sensor s, int a) { }

    // ===================== elementi disegnati =====================

    /**
     * Cornice della foto sull'anteprima: nel formato 1:1 scurisce ciò che resta fuori dal quadrato;
     * con la griglia accesa disegna i terzi dentro la foto.
     */
    private static class Griglia extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG), velo = new Paint();
        private boolean linee = true;
        private String formato = "4:3";
        Griglia(Context c) { super(c); p.setColor(0x66FFFFFF); p.setStrokeWidth(c.getResources().getDisplayMetrics().density); velo.setColor(0x99000000); }
        void linee(boolean si) { linee = si; invalidate(); }
        boolean conLinee() { return linee; }
        void formato(String f) { formato = f; invalidate(); }
        void margini(int a, int b) { invalidate(); }
        @Override protected void onDraw(@NonNull Canvas c) {
            // area dell'anteprima (adattata al centro, come la PreviewView): 3:4 o 9:16 in verticale
            float w = getWidth(), h = getHeight(), alto = "16:9".equals(formato) ? 16f / 9f : 4f / 3f;
            float aw = w, ah = w * alto;
            if (ah > h) { ah = h; aw = h / alto; }
            float ax = (w - aw) / 2f, ay = (h - ah) / 2f;
            // area della foto
            float fx = ax, fy = ay, fw = aw, fh = ah;
            if ("1:1".equals(formato)) {
                float lato = Math.min(aw, ah);
                fx = (w - lato) / 2f; fy = (h - lato) / 2f; fw = lato; fh = lato;
                c.drawRect(ax, ay, aw + ax, fy, velo);
                c.drawRect(ax, fy + fh, aw + ax, ay + ah, velo);
            }
            if (!linee) return;
            for (int i = 1; i < 3; i++) {
                c.drawLine(fx + fw * i / 3f, fy, fx + fw * i / 3f, fy + fh, p);
                c.drawLine(fx, fy + fh * i / 3f, fx + fw, fy + fh * i / 3f, p);
            }
        }
    }

    /** Livella: una linea che segue l'orizzonte, verde quando il telefono è dritto. */
    private static class Livella extends View {
        private final Paint linea = new Paint(Paint.ANTI_ALIAS_FLAG), tacche = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float angolo;
        private boolean piatto = true;
        private final float d;
        Livella(Context c) {
            super(c);
            d = c.getResources().getDisplayMetrics().density;
            linea.setStrokeWidth(2.5f * d); linea.setStrokeCap(Paint.Cap.ROUND);
            tacche.setStrokeWidth(2f * d); tacche.setColor(0x99FFFFFF); tacche.setStrokeCap(Paint.Cap.ROUND);
        }
        void imposta(float a, boolean p) {
            angolo = angolo * 0.75f + a * 0.25f;   // un po' di morbidezza, senza tremolii
            piatto = p;
            invalidate();
        }
        @Override protected void onDraw(@NonNull Canvas c) {
            if (piatto) return;
            float scarto = angolo - Math.round(angolo / 90f) * 90f;
            boolean dritto = Math.abs(scarto) < 1f;
            float cx = getWidth() / 2f, cy = getHeight() / 2f, mezza = 70 * d;
            c.save();
            c.rotate(-Math.round(angolo / 90f) * 90f, cx, cy);   // tacche fisse lungo l'orizzonte del modo in cui si tiene il telefono
            c.drawLine(cx - mezza - 26 * d, cy, cx - mezza - 10 * d, cy, tacche);
            c.drawLine(cx + mezza + 10 * d, cy, cx + mezza + 26 * d, cy, tacche);
            c.restore();
            c.save();
            c.rotate(-angolo, cx, cy);
            linea.setColor(dritto ? VERDE : Color.WHITE);
            c.drawLine(cx - mezza, cy, cx + mezza, cy, linea);
            c.restore();
        }
    }

    /** Cerchio della messa a fuoco nel punto toccato. */
    private static class Fuoco extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float x = -1, y = -1;
        Fuoco(Context c) { super(c); p.setStyle(Paint.Style.STROKE); p.setColor(AMBRA); p.setStrokeWidth(2f * c.getResources().getDisplayMetrics().density); }
        void mostra(float px, float py) {
            x = px; y = py;
            setAlpha(1f); setScaleX(1f); setScaleY(1f);
            invalidate();
            animate().cancel();
            animate().alpha(0f).setStartDelay(900).setDuration(400).start();
        }
        @Override protected void onDraw(@NonNull Canvas c) {
            if (x < 0) return;
            c.drawCircle(x, y, 34 * getResources().getDisplayMetrics().density, p);
        }
    }

    /** Pulsante di scatto: anello ambra, cerchio bianco. */
    private static class Otturatore extends View {
        private final Paint anello = new Paint(Paint.ANTI_ALIAS_FLAG), pieno = new Paint(Paint.ANTI_ALIAS_FLAG);
        private boolean occupato;
        Otturatore(Context c) {
            super(c);
            anello.setStyle(Paint.Style.STROKE); anello.setColor(AMBRA); anello.setStrokeWidth(4.5f * c.getResources().getDisplayMetrics().density);
            pieno.setColor(Color.WHITE);
            setClickable(true);
        }
        void setOccupato(boolean o) { occupato = o; invalidate(); }
        @Override public boolean onTouchEvent(MotionEvent e) {
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) animate().scaleX(0.9f).scaleY(0.9f).setDuration(90).start();
            if (e.getActionMasked() == MotionEvent.ACTION_UP || e.getActionMasked() == MotionEvent.ACTION_CANCEL) animate().scaleX(1f).scaleY(1f).setDuration(160).start();
            return super.onTouchEvent(e);
        }
        @Override protected void onDraw(@NonNull Canvas c) {
            float d = getResources().getDisplayMetrics().density, r = Math.min(getWidth(), getHeight()) / 2f;
            c.drawCircle(getWidth() / 2f, getHeight() / 2f, r - 3 * d, anello);
            pieno.setColor(occupato ? 0xFF94A3B8 : Color.WHITE);
            c.drawCircle(getWidth() / 2f, getHeight() / 2f, r - 10 * d, pieno);
        }
    }
}
