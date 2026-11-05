#ifndef MR_RESUME_SYNCTEX_MEMORY_H
#define MR_RESUME_SYNCTEX_MEMORY_H

#include <stddef.h>

/* The upstream parser's read-only zlib interface, backed by one already
 * decompressed, bounded memory buffer. No paths can reach a host filesystem. */
typedef struct mr_synctex_file *gzFile;
typedef long z_off_t;
#define Z_ERRNO (-1)
gzFile gzopen(const char *path, const char *mode);
int gzread(gzFile file, void *buffer, unsigned length);
int gzclose(gzFile file);
z_off_t gztell(gzFile file);
z_off_t gzseek(gzFile file, z_off_t offset, int origin);
const char *gzerror(gzFile file, int *error);
int gzwrite(gzFile file, const void *buffer, unsigned length);

#endif
