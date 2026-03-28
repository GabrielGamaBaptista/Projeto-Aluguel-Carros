package com.bapcar;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;

public class BatteryOptimizationModule extends ReactContextBaseJavaModule {
    BatteryOptimizationModule(ReactApplicationContext context) { super(context); }

    @Override public String getName() { return "BatteryOptimization"; }

    @ReactMethod
    public void isIgnoring(Promise promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getReactApplicationContext()
                .getSystemService(Context.POWER_SERVICE);
            promise.resolve(pm.isIgnoringBatteryOptimizations(
                getReactApplicationContext().getPackageName()));
        } else {
            promise.resolve(true);
        }
    }

    @ReactMethod
    public void requestIgnore(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) getReactApplicationContext()
                    .getSystemService(Context.POWER_SERVICE);
                if (pm.isIgnoringBatteryOptimizations(
                        getReactApplicationContext().getPackageName())) {
                    promise.resolve(true);
                    return;
                }
                Intent intent = new Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getReactApplicationContext().getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getReactApplicationContext().startActivity(intent);
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }
}
