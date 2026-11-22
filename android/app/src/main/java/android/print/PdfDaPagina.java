package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * Scrive in un file PDF ciò che un adattatore di stampa (per esempio quello di una WebView) sa disegnare, senza passare
 * dalla finestra di stampa di Android. Sta nel pacchetto «android.print» perché i suoi «callback» si possono creare solo da lì.
 * Serve quando il servizio di stampa non si lascia usare: il PDF si apre con un'altra app, da cui si stampa o si condivide.
 */
public final class PdfDaPagina {
    public interface Fine {
        void ok();
        void errore(String motivo);
    }

    private PdfDaPagina() { }

    /** Da chiamare dal thread principale. */
    public static void scrivi(final PrintDocumentAdapter adattatore, final File file, final Fine fine) {
        final PrintAttributes attributi = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build();
        adattatore.onLayout(null, attributi, new CancellationSignal(), new PrintDocumentAdapter.LayoutResultCallback() {
            @Override public void onLayoutFinished(PrintDocumentInfo info, boolean cambiato) {
                try {
                    final ParcelFileDescriptor fd = ParcelFileDescriptor.open(file,
                            ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
                    adattatore.onWrite(new PageRange[] { PageRange.ALL_PAGES }, fd, new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
                        @Override public void onWriteFinished(PageRange[] pagine) {
                            try { fd.close(); } catch (Exception ignorata) { }
                            fine.ok();
                        }
                        @Override public void onWriteFailed(CharSequence errore) {
                            try { fd.close(); } catch (Exception ignorata) { }
                            fine.errore(String.valueOf(errore));
                        }
                    });
                } catch (Exception e) {
                    fine.errore(String.valueOf(e.getMessage()));
                }
            }
            @Override public void onLayoutFailed(CharSequence errore) { fine.errore(String.valueOf(errore)); }
        }, null);
    }
}
