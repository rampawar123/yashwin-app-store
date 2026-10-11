# YASHWIN AI Trading — ProGuard / R8 Rules
# Keep WebView and AndroidX WebKit classes intact; never obfuscate error codes.
-keepattributes *Annotation*,SourceFile,LineNumberTable
-keep class androidx.webkit.** { *; }
-dontwarn androidx.webkit.**
