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
# Tensor G3 (Cortex-X3, A715, A510 : Armv9-A) : SVE2, i8mm, produit scalaire, fp16, et OpenMP lié en statique,
# comme le build natif de Termux (system_info : SVE = 1, MATMUL_INT8 = 1, OPENMP = 1). Sans SVE ni OpenMP, mesuré le
# 12/11 : 25 s par minute d'appel, contre 11 s sous Termux.
set(GGML_CPU_ARM_ARCH "armv9-a+i8mm+dotprod+fp16" CACHE STRING "" FORCE)
set(GGML_OPENMP ON CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)

add_subdirectory(${WHISPER_DIR} whisper EXCLUDE_FROM_ALL)

add_library(telephonie_stt SHARED stt_jni.cpp)
target_link_libraries(telephonie_stt PRIVATE parakeet ggml log)
target_compile_options(telephonie_stt PRIVATE -O3)
target_link_options(telephonie_stt PRIVATE -fopenmp -static-openmp)
