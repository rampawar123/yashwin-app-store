package com.example.hiram;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

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
        return ContextCompat.checkSelfPermission(
                context, Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private String normalizeName(String name) {
        if (name == null) return "";
        return name.trim().toLowerCase(Locale.ROOT)
                .replaceAll("\\s+", " ");
    }

    public List<ContactInfo> findContacts(String contactName) {
        List<ContactInfo> contacts = new ArrayList<>();

        if (contactName == null || contactName.trim().isEmpty()
                || !hasContactsPermission()) {
            return contacts;
        }

        String query = contactName.trim();

        String[] projection = {
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        String selection =
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?";
        String[] selectionArgs = {"%" + query + "%"};

        Set<String> seenNumbers = new HashSet<>();

        try (Cursor cursor = context.getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC")) {

            if (cursor == null) return contacts;

            while (cursor.moveToNext()) {
                String name = cursor.getString(0);
                String number = cursor.getString(1);

                if (name == null || number == null || number.trim().isEmpty()) {
                    continue;
                }

                String normalizedNumber = number.replaceAll("[^0-9+]", "");
                if (normalizedNumber.isEmpty()
                        || !seenNumbers.add(normalizedNumber)) {
                    continue;
                }

                contacts.add(new ContactInfo(name, number));
            }
        } catch (SecurityException e) {
            return new ArrayList<>();
        }

        return contacts;
    }

    /**
     * Returns a contact only when the match is unambiguous.
     * Exact name matches take priority over partial matches.
     */
    public ContactInfo findContact(String contactName) {
        List<ContactInfo> matches = findContacts(contactName);

        if (matches.isEmpty()) return null;

        String requested = normalizeName(contactName);
        List<ContactInfo> exactMatches = new ArrayList<>();

        for (ContactInfo contact : matches) {
            if (normalizeName(contact.name).equals(requested)) {
                exactMatches.add(contact);
            }
        }

        if (exactMatches.size() == 1) {
            return exactMatches.get(0);
        }

        if (exactMatches.size() > 1) {
            return null;
        }

        return matches.size() == 1 ? matches.get(0) : null;
    }

    public Intent createDialIntent(String number) {
        if (number == null || number.trim().isEmpty()) return null;

        Intent intent = new Intent(Intent.ACTION_DIAL);
        intent.setData(Uri.parse("tel:" + Uri.encode(number)));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    public Intent createCallIntent(String number) {
        if (number == null || number.trim().isEmpty()) return null;

        Intent intent;
        if (ContextCompat.checkSelfPermission(
                context, Manifest.permission.CALL_PHONE)
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
