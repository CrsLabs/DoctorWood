package it.doctorwood.app;

import android.content.Context;
import android.content.res.Configuration;
import android.os.Bundle;
import android.os.LocaleList;

import java.util.Locale;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // L'app è in italiano: anche i campi data e ora (calendario, orologio, «gg/mm/aaaa») e i numeri
    // della WebView seguono l'italiano, qualunque sia la lingua del telefono.
    @Override
    protected void attachBaseContext(Context base) {
        Locale it = Locale.ITALY;
        Locale.setDefault(it);
        LocaleList.setDefault(new LocaleList(it));
        Configuration c = new Configuration(base.getResources().getConfiguration());
        c.setLocales(new LocaleList(it));
        super.attachBaseContext(base.createConfigurationContext(c));
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CassafortePlugin.class);
        registerPlugin(LaboratorioPlugin.class);
        registerPlugin(pairwood.capacitor.PairWoodPlugin.class);   // sincronizzazione diretta (PairWood)
        super.onCreate(savedInstanceState);
        // nell'elenco delle app recenti non si vede il contenuto (clienti, prezzi): da Android 13
        if (android.os.Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        avvisaTastiera();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // la pagina gestisce gia' il tasto Indietro come nel browser (chiude la finestra aperta,
                // torna alla Home, al secondo Indietro esce): qui si passa solo alla cronologia della pagina
                android.webkit.WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv != null && wv.canGoBack()) wv.goBack();
                else moveTaskToBack(true);   // l'app va in secondo piano, non si chiude
            }
        });
    }
    /** Dice alla pagina quanto della finestra è coperto dalla tastiera (px della pagina), così la finestra si accorcia e scorre. */
    private int tastieraVista = -1;
    private void avvisaTastiera() {
        final android.view.View dv = getWindow().getDecorView();
        androidx.core.view.ViewCompat.setWindowInsetsAnimationCallback(dv,
            new androidx.core.view.WindowInsetsAnimationCompat.Callback(androidx.core.view.WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                @Override
                public androidx.core.view.WindowInsetsCompat onProgress(androidx.core.view.WindowInsetsCompat insets,
                                                                        java.util.List<androidx.core.view.WindowInsetsAnimationCompat> animazioni) {
                    dallaTastiera(insets);
                    return insets;
                }
                @Override
                public void onEnd(androidx.core.view.WindowInsetsAnimationCompat animazione) {
                    dallaTastiera(androidx.core.view.ViewCompat.getRootWindowInsets(dv));
                }
            });
    }
    private void dallaTastiera(androidx.core.view.WindowInsetsCompat wi) {
        if (wi == null) return;
        int kb = wi.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()) ? wi.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime()).bottom : 0;
        if (kb == tastieraVista) return;
        tastieraVista = kb;
        final android.webkit.WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv == null) return;
        final int px = Math.round(kb / getResources().getDisplayMetrics().density);
        wv.post(() -> wv.evaluateJavascript("window.__tastiera&&window.__tastiera(" + px + ")", null));
    }

    /** Pausa e ripresa dell'app: la pagina decide se bloccare (anche quando si apre solo l'elenco delle app recenti). */
    private void alla(String funzione) {
        final android.webkit.WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv != null) wv.post(() -> wv.evaluateJavascript("window." + funzione + "&&window." + funzione + "()", null));
    }
    @Override
    public void onPause() { pausata = !isChangingConfigurations() && !isInMultiWindowMode(); if (pausata) alla("__pausaApp"); super.onPause(); }
    /** Messa in pausa da Android (app recenti, Home, schermo spento): al ritorno la pagina decide se chiedere l'impronta. Le finestre affiancate e la tendina delle notifiche non fermano l'app: non contano. */
    private boolean pausata = false;
    @Override
    public void onResume() { super.onResume(); if (pausata) { pausata = false; alla("__pausaApp"); alla("__ripresaApp"); } }



    /**
     * Il gesto delle app recenti toglie all'app il primo piano (anche senza fermarla): conta come uscire. La tendina delle
     * notifiche no (l'app resta in primo piano), e nemmeno passare all'altra di due finestre affiancate.
     */
    @Override
    public void onTopResumedActivityChanged(boolean primoPiano) {
        super.onTopResumedActivityChanged(primoPiano);
        if (!primoPiano) { if (!isInMultiWindowMode() && !isChangingConfigurations() && !pausata) { pausata = true; alla("__pausaApp"); } }
        else if (pausata) { pausata = false; alla("__pausaApp"); alla("__ripresaApp"); }
    }
}
