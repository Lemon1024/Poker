package org.rivernotes.poker;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.database.sqlite.SQLiteOpenHelper;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;

/** The local page acknowledges a save only after the SQLite insert commits. */
public final class HistoryStore extends SQLiteOpenHelper {
    private final SharedPreferences ranges;
    HistoryStore(Context context) {
        super(context, "equity-history.db", null, 1);
        ranges = context.getSharedPreferences("opponent-ranges-v1", Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public String readRanges() {
        return new JSONObject(ranges.getAll()).toString();
    }

    @JavascriptInterface
    public boolean saveRange(String name, String rangeText) {
        return ranges.edit().putString(name, rangeText).commit();
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE hands (id INTEGER PRIMARY KEY, record TEXT NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unsupported equity history version");
    }

    @JavascriptInterface
    public boolean append(String record) {
        ContentValues row = new ContentValues();
        row.put("record", record);
        try {
            getWritableDatabase().insertOrThrow("hands", null, row);
            return true;
        } catch (SQLiteException failed) {
            return false;
        }
    }

    @JavascriptInterface
    public String read() {
        StringBuilder records = new StringBuilder("[");
        try (Cursor rows = getReadableDatabase().rawQuery("SELECT record FROM hands ORDER BY id DESC", null)) {
            while (rows.moveToNext()) {
                if (records.length() > 1) records.append(',');
                records.append(rows.getString(0));
            }
        }
        return records.append(']').toString();
    }
}
