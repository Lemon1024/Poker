using System;
using System.Runtime.InteropServices;

namespace RiverNotes
{
    public static class EmulatorWindow
    {
        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        private static extern IntPtr GetThreadDesktop(uint thread);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool GetUserObjectInformation(IntPtr handle, int index,
            out int value, int size, out int needed);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string className, string title);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool ShowWindowAsync(IntPtr window, int command);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr window);

        public static bool OnInputDesktop()
        {
            const int UoiIo = 6;
            int active, needed;
            return GetUserObjectInformation(GetThreadDesktop(GetCurrentThreadId()),
                UoiIo, out active, sizeof(int), out needed) && active != 0;
        }

        public static bool BringForward(string title)
        {
            IntPtr window = FindWindow(null, title);
            if (window == IntPtr.Zero || !IsWindowVisible(window)) return false;
            if (IsIconic(window)) ShowWindowAsync(window, 9); // SW_RESTORE
            SetForegroundWindow(window);
            return true;
        }
    }
}
