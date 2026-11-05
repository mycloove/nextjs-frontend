#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "zlib.h"
#include "synctex_parser.h"

struct mr_synctex_file { size_t offset; };
static const unsigned char *input;
static size_t input_size;

gzFile gzopen(const char *path, const char *mode) {
    if (!input || strcmp(path, "/output.synctex") || strcmp(mode, "r")) {
        errno = ENOENT;
        return NULL;
    }
    return calloc(1, sizeof(struct mr_synctex_file));
}

int gzread(gzFile file, void *buffer, unsigned length) {
    if (!file || file->offset > input_size) return -1;
    size_t remaining = input_size - file->offset;
    if (length > remaining) length = (unsigned)remaining;
    memcpy(buffer, input + file->offset, length);
    file->offset += length;
    return (int)length;
}

int gzclose(gzFile file) { free(file); return 0; }
z_off_t gztell(gzFile file) { return file ? (z_off_t)file->offset : -1; }
z_off_t gzseek(gzFile file, z_off_t offset, int origin) {
    if (!file || origin != SEEK_SET || offset < 0 || (size_t)offset > input_size) return -1;
    file->offset = (size_t)offset;
    return offset;
}
const char *gzerror(gzFile file, int *error) {
    (void)file;
    *error = Z_ERRNO;
    return "SyncTeX memory input refused";
}
int gzwrite(gzFile file, const void *buffer, unsigned length) {
    (void)file; (void)buffer; (void)length;
    errno = EROFS;
    return -1;
}

synctex_scanner_p mr_synctex_load(const unsigned char *data, int length) {
    if (!data || length < 1 || length > 8 * 1024 * 1024) return NULL;
    input = data;
    input_size = (size_t)length;
    synctex_scanner_p scanner = synctex_scanner_new_with_output_file("/output.pdf", NULL, 1);
    input = NULL;
    input_size = 0;
    return scanner;
}

int mr_synctex_node_count(synctex_scanner_p scanner) {
    int count = 0;
    for (int page = 1; page <= 32; page++) {
        synctex_node_p sheet = synctex_sheet(scanner, page);
        if (!sheet) continue;
        for (synctex_node_p node = synctex_node_child(sheet); node; node = synctex_node_next(node)) {
            if (++count > 32768) return -1;
        }
    }
    return count;
}
