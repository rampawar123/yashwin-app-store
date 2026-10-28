package com.example.hiram;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import androidx.core.content.ContextCompat;

/**
 * ContactHelper - Queries phone contacts and formats dial/message intents.
 */
public class ContactHelper {

    private final Context context;

    public static class ContactInfo {
        public final String name;
        public final String number;

        public ContactInfo(String name, String number) {
            this.name = name;
            this.number = number;
        }
    }

    public ContactHelper(Context context) {
        this.context = context.getApplicationContext();
    }

    public boolean hasContactsPermission() {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;
    }

    public ContactInfo findContact(String contactName) {
        if (contactName == null || contactName.trim().isEmpty()) {
            return null;
        }

        if (!hasContactsPermission()) {
            return null;
        }

        String[] projection = {
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        String selection = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?";
        String[] selectionArgs = { "%" + contactName.trim() + "%" };

        try (Cursor cursor = context.getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC")) {

            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                String number = cursor.getString(1);
                return new ContactInfo(name, number);
            }
        } catch (SecurityException ignored) {}

        return null;
    }

    public Intent createDialIntent(String number) {
        Intent intent = new Intent(Intent.ACTION_DIAL);
        intent.setData(Uri.parse("tel:" + Uri.encode(number)));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    public Intent createCallIntent(String number) {
        Intent intent;
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE)
                == PackageManager.PERMISSION_GRANTED) {
            intent = new Intent(Intent.ACTION_CALL);
        } else {
            intent = new Intent(Intent.ACTION_DIAL);
        }
        intent.setData(Uri.parse("tel:" + Uri.encode(number)));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }
}
