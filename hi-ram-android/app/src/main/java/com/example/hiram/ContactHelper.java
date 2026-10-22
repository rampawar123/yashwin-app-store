
package com.example.hiram;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.ContactsContract;

import androidx.core.content.ContextCompat;

public class ContactHelper {

    private final Context context;

    public ContactHelper(Context context) {
        this.context = context.getApplicationContext();
    }

    public String findContactNumber(String contactName) {
        if (contactName == null || contactName.trim().isEmpty()) {
            return "Contact ka naam batayein.";
        }

        if (ContextCompat.checkSelfPermission(
                context, Manifest.permission.READ_CONTACTS)
                != PackageManager.PERMISSION_GRANTED) {
            return "Contacts permission pehle Settings se allow karein.";
        }

        String[] projection = {
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        String selection =
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?";

        String[] selectionArgs = {
                "%" + contactName.trim() + "%"
        };

        try (Cursor cursor = context.getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC")) {

            if (cursor == null || !cursor.moveToFirst()) {
                return "Is naam ka contact nahi mila.";
            }

            String name = cursor.getString(0);
            String number = cursor.getString(1);

            return name + ": " + number;

        } catch (SecurityException e) {
            return "Contacts permission nahi mili.";
        }
    }
}
