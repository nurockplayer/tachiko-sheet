#include <errno.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>

int main(void) {
  int capacity = proc_listallpids(NULL, 0);
  if (capacity <= 0) { perror("proc_listallpids"); return 1; }
  // Leave room for processes created between sizing and reading the table.
  capacity = capacity * 2 + 32;
  pid_t *pids = calloc(capacity, sizeof(pid_t));
  if (!pids) { perror("calloc"); return 1; }
  int count = proc_listallpids(pids, capacity * sizeof(pid_t));
  if (count <= 0 || count >= capacity) {
    fprintf(stderr, "cannot read complete process table\n");
    free(pids);
    return 1;
  }
  for (int i = 0; i < count; i++) {
    if (pids[i] <= 0) continue;
    struct proc_bsdinfo info;
    int size = proc_pidinfo(pids[i], PROC_PIDTBSDINFO, 0, &info, sizeof(info));
    if (size != sizeof(info)) {
      if (size == 0 && (errno == ESRCH || errno == EPERM || errno == EACCES)) continue;
      fprintf(stderr, "cannot inspect process %d: %d bytes, errno %d\n", pids[i], size, errno);
      free(pids);
      return 1;
    }
    printf("%u %u %u %llu.%06llu\n", info.pbi_pid, info.pbi_ppid, info.pbi_pgid,
      (unsigned long long)info.pbi_start_tvsec, (unsigned long long)info.pbi_start_tvusec);
  }
  free(pids);
  return 0;
}
