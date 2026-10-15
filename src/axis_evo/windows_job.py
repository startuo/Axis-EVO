"""Win32 child lifetime limits, installed before the suspended child can run."""
import ctypes
from ctypes import wintypes as w


class _Basic(ctypes.Structure):
    _fields_ = [('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong),
        ('flags', w.DWORD), ('min_ws', ctypes.c_size_t), ('max_ws', ctypes.c_size_t),
        ('active_limit', w.DWORD), ('affinity', ctypes.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]


class _IO(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in ('read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes')]


class _Extended(ctypes.Structure):
    _fields_ = [('basic', _Basic), ('io', _IO), ('process_memory', ctypes.c_size_t),
               ('job_memory', ctypes.c_size_t), ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]


class _Thread(ctypes.Structure):
    _fields_ = [('size', w.DWORD), ('usage', w.DWORD), ('thread_id', w.DWORD),
               ('owner_pid', w.DWORD), ('priority', w.LONG), ('delta', w.LONG), ('flags', w.DWORD)]


class WindowsJob:
    def __init__(self):
        self.kernel = k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.CreateJobObjectW.argtypes, k.CreateJobObjectW.restype = (ctypes.c_void_p, w.LPCWSTR), w.HANDLE
        k.SetInformationJobObject.argtypes, k.SetInformationJobObject.restype = (w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD), w.BOOL
        k.AssignProcessToJobObject.argtypes, k.AssignProcessToJobObject.restype = (w.HANDLE, w.HANDLE), w.BOOL
        k.TerminateJobObject.argtypes, k.TerminateJobObject.restype = (w.HANDLE, w.UINT), w.BOOL
        k.CloseHandle.argtypes, k.CloseHandle.restype = (w.HANDLE,), w.BOOL
        self.handle = k.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = _Extended()
        # Kill on last handle close; bounded whole-job memory and child count.
        limits.basic.flags = 0x2000 | 0x200 | 0x8
        limits.basic.active_limit = 8
        limits.job_memory = 512 * 1024 * 1024
        if not k.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.close()
            raise ctypes.WinError(ctypes.get_last_error())

    def attach_and_resume(self, process):
        k = self.kernel
        if not k.AssignProcessToJobObject(self.handle, int(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())
        k.CreateToolhelp32Snapshot.argtypes, k.CreateToolhelp32Snapshot.restype = (w.DWORD, w.DWORD), w.HANDLE
        k.Thread32First.argtypes, k.Thread32First.restype = (w.HANDLE, ctypes.POINTER(_Thread)), w.BOOL
        k.Thread32Next.argtypes, k.Thread32Next.restype = k.Thread32First.argtypes, w.BOOL
        k.OpenThread.argtypes, k.OpenThread.restype = (w.DWORD, w.BOOL, w.DWORD), w.HANDLE
        k.ResumeThread.argtypes, k.ResumeThread.restype = (w.HANDLE,), w.DWORD
        snapshot = k.CreateToolhelp32Snapshot(4, 0)
        if snapshot == w.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            thread = _Thread()
            thread.size = ctypes.sizeof(thread)
            found = k.Thread32First(snapshot, ctypes.byref(thread))
            while found:
                if thread.owner_pid == process.pid:
                    handle = k.OpenThread(2, False, thread.thread_id)
                    if not handle:
                        raise ctypes.WinError(ctypes.get_last_error())
                    try:
                        if k.ResumeThread(handle) != 1:
                            raise OSError('suspended child could not be resumed')
                        return
                    finally:
                        k.CloseHandle(handle)
                found = k.Thread32Next(snapshot, ctypes.byref(thread))
            raise OSError('suspended child thread was not found')
        finally:
            k.CloseHandle(snapshot)

    def terminate(self):
        if self.handle:
            self.kernel.TerminateJobObject(self.handle, 1)

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
