# Parakeet (whisper.cpp, cible parakeet) en bibliothèque statique, liée à une seule .so JNI.
# WHISPER_DIR : whisper.cpp au commit épinglé dans outils/construire.sh (jamais copié dans le dépôt).
cmake_minimum_required(VERSION 3.22.1)
project(telephonie_stt C CXX)

if(NOT WHISPER_DIR)
    message(FATAL_ERROR "WHISPER_DIR manquant : lancer outils/construire.sh")
endif()

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(WHISPER_ALL_WARNINGS OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
# Tensor G3 (Cortex-X3, A715, A510) : produit scalaire et i8mm pour le q8_0. Pas d'OpenMP (libomp à embarquer) :
# le pool de fils de ggml suffit.
set(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod+i8mm+fp16" CACHE STRING "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)

add_subdirectory(${WHISPER_DIR} whisper EXCLUDE_FROM_ALL)

add_library(telephonie_stt SHARED stt_jni.cpp)
target_link_libraries(telephonie_stt PRIVATE parakeet ggml log)
target_compile_options(telephonie_stt PRIVATE -O3)
