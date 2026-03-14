# ============================================
# ProGuard Rules - AluguelCarrosApp
# React Native + Firebase + Libs
# ============================================

# --- React Native ---
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.react.**
-dontwarn com.facebook.hermes.**

# Hermes engine (usado no release)
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# --- Firebase ---
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Firebase Auth
-keep class com.google.firebase.auth.** { *; }
-keepattributes Signature
-keepattributes *Annotation*

# Firebase Firestore
-keep class com.google.firebase.firestore.** { *; }
-keep class io.grpc.** { *; }
-dontwarn io.grpc.**

# --- React Native Firebase ---
-keep class io.invertase.firebase.** { *; }
-dontwarn io.invertase.firebase.**

# --- React Native Image Picker ---
-keep class com.imagepicker.** { *; }
-dontwarn com.imagepicker.**

# --- React Native Document Picker (@react-native-documents/picker) ---
-keep class com.reactnativedocumentpicker.** { *; }
-dontwarn com.reactnativedocumentpicker.**

# --- React Native Safe Area Context ---
-keep class com.th3rdwave.safeareacontext.** { *; }
-dontwarn com.th3rdwave.safeareacontext.**

# --- React Navigation ---
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.th3rdwave.safeareacontext.** { *; }
-dontwarn com.swmansion.**

# --- OkHttp (usado pelo React Native para networking) ---
-keep class okhttp3.** { *; }
-keep class okio.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**

# --- General ---
-keepattributes SourceFile,LineNumberTable
-keepattributes JavascriptInterface
-keep class * implements com.facebook.react.bridge.NativeModule { *; }
-keep class * implements com.facebook.react.bridge.JavaScriptModule { *; }
-keep class * extends com.facebook.react.bridge.ReactContextBaseJavaModule { *; }

# Manter classes nativas com @ReactMethod
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}

# Evitar problemas com reflexao
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}
-keep @com.facebook.proguard.annotations.DoNotStrip class *

# Evitar warnings desnecessarios
-dontwarn javax.annotation.**
-dontwarn sun.misc.**
-dontwarn java.nio.file.**
-dontwarn org.codehaus.mojo.**
