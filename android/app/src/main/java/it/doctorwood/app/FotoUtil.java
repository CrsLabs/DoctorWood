package it.doctorwood.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;

import androidx.exifinterface.media.ExifInterface;

import java.io.File;
import java.io.FileOutputStream;

/** Foto pronte per l'app: lato lungo al massimo LATO_MAX, raddrizzate secondo l'EXIF, JPEG di buona qualità. */
final class FotoUtil {
    static final int LATO_MAX = 2560;
    static final int QUALITA = 90;

    private FotoUtil() { }

    /** Legge una foto JPEG grande e ne scrive una versione ridotta e raddrizzata in «dest». */
    static void prepara(File origine, File dest) throws Exception { prepara(origine, dest, false); }

    /** Come sopra; con «quadrata» tiene solo il quadrato centrale (formato 1:1). */
    static void prepara(File origine, File dest, boolean quadrata) throws Exception {
        BitmapFactory.Options misure = new BitmapFactory.Options();
        misure.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(origine.getAbsolutePath(), misure);
        if (misure.outWidth <= 0 || misure.outHeight <= 0) throw new Exception("foto non leggibile");

        // si decodifica già rimpicciolita (meno memoria sui telefoni vecchi), poi si rifinisce
        int campione = 1;
        while (Math.max(misure.outWidth, misure.outHeight) / (campione * 2) >= LATO_MAX) campione *= 2;
        BitmapFactory.Options opz = new BitmapFactory.Options();
        opz.inSampleSize = campione;
        Bitmap bmp = BitmapFactory.decodeFile(origine.getAbsolutePath(), opz);
        if (bmp == null) throw new Exception("foto non leggibile");

        int gradi = 0;
        try {
            int o = new ExifInterface(origine.getAbsolutePath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            gradi = o == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : o == ExifInterface.ORIENTATION_ROTATE_180 ? 180 : o == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
        } catch (Exception ignored) { }

        float k = Math.min(1f, (float) LATO_MAX / Math.max(bmp.getWidth(), bmp.getHeight()));
        if (gradi != 0 || k < 1f) {
            Matrix m = new Matrix();
            if (k < 1f) m.postScale(k, k);
            if (gradi != 0) m.postRotate(gradi);
            Bitmap r = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
            if (r != bmp) bmp.recycle();
            bmp = r;
        }
        if (quadrata && bmp.getWidth() != bmp.getHeight()) {
            int lato = Math.min(bmp.getWidth(), bmp.getHeight());
            Bitmap q = Bitmap.createBitmap(bmp, (bmp.getWidth() - lato) / 2, (bmp.getHeight() - lato) / 2, lato, lato);
            if (q != bmp) bmp.recycle();
            bmp = q;
        }
        try (FileOutputStream out = new FileOutputStream(dest)) {
            bmp.compress(Bitmap.CompressFormat.JPEG, QUALITA, out);
        } finally {
            bmp.recycle();
        }
    }

    /** Miniatura per la striscia in basso. */
    static Bitmap miniatura(File f, int lato) {
        BitmapFactory.Options misure = new BitmapFactory.Options();
        misure.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(f.getAbsolutePath(), misure);
        int campione = 1;
        while (Math.min(misure.outWidth, misure.outHeight) / (campione * 2) >= lato) campione *= 2;
        BitmapFactory.Options opz = new BitmapFactory.Options();
        opz.inSampleSize = campione;
        return BitmapFactory.decodeFile(f.getAbsolutePath(), opz);
    }
}
