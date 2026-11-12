// Pont JNI vers Parakeet (whisper.cpp) : charger le modèle une fois, transcrire un tronçon de PCM 16 kHz,
// rendre ses jetons horodatés comme `parakeet-cli -ps` (t0, t1 en centièmes, début de mot, texte brut).
#include <jni.h>
#include <string>
#include <android/log.h>
#include "parakeet.h"

static void journal_ggml(enum ggml_log_level niveau, const char * texte, void *) {
    if (niveau >= GGML_LOG_LEVEL_WARN) __android_log_print(ANDROID_LOG_WARN, "TelephonieCRM", "parakeet: %s", texte);
}

extern "C" JNIEXPORT jlong JNICALL
Java_site_veridian_telephonie_Parakeet_charger(JNIEnv * env, jclass, jstring chemin) {
    parakeet_log_set(journal_ggml, nullptr);
    const char * c = env->GetStringUTFChars(chemin, nullptr);
    parakeet_context_params p = parakeet_context_default_params();
    p.use_gpu = false;
    parakeet_context * ctx = parakeet_init_from_file_with_params(c, p);
    env->ReleaseStringUTFChars(chemin, c);
    return reinterpret_cast<jlong>(ctx);
}

extern "C" JNIEXPORT void JNICALL
Java_site_veridian_telephonie_Parakeet_liberer(JNIEnv *, jclass, jlong ctx) {
    if (ctx) parakeet_free(reinterpret_cast<parakeet_context *>(ctx));
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_site_veridian_telephonie_Parakeet_transcrireOctets(JNIEnv * env, jclass, jlong contexte, jfloatArray pcm, jint fils) {
    auto * ctx = reinterpret_cast<parakeet_context *>(contexte);
    if (!ctx) return nullptr;
    const jsize n = env->GetArrayLength(pcm);
    jfloat * echantillons = env->GetFloatArrayElements(pcm, nullptr);
    parakeet_full_params params = parakeet_full_default_params(PARAKEET_SAMPLING_GREEDY);
    params.n_threads = fils;
    const int ret = parakeet_full(ctx, params, echantillons, n);
    env->ReleaseFloatArrayElements(pcm, echantillons, JNI_ABORT);
    if (ret != 0) return nullptr;
    std::string sortie;
    const int segments = parakeet_full_n_segments(ctx);
    for (int i = 0; i < segments; i++) {
        const int jetons = parakeet_full_n_tokens(ctx, i);
        for (int j = 0; j < jetons; j++) {
            parakeet_token_data d = parakeet_full_get_token_data(ctx, i, j);
            const char * texte = parakeet_token_to_str(ctx, d.id);
            sortie += std::to_string((long long) d.t0) + "\t" + std::to_string((long long) d.t1) + "\t" +
                      (d.is_word_start ? "1" : "0") + "\t" + (texte ? texte : "") + "\n";
        }
    }
    // en octets UTF-8 : NewStringUTF n'accepte que l'UTF-8 modifié de Java
    jbyteArray octets = env->NewByteArray((jsize) sortie.size());
    env->SetByteArrayRegion(octets, 0, (jsize) sortie.size(), reinterpret_cast<const jbyte *>(sortie.data()));
    return octets;
}
