using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using System.Reflection;

[assembly: AssemblyTitle("Axis-Evo")]
[assembly: AssemblyProduct("Axis-Evo 0.1.0 Preview M7")]
[assembly: AssemblyCompany("Axis-Evo")]
[assembly: AssemblyFileVersion("0.1.0.70")]
[assembly: AssemblyVersion("0.1.0.70")]

namespace AxisEvo.Desktop
{
    internal sealed class Launcher : Form
    {
        private static readonly Regex ReadyLine = new Regex(
            @"\AAXIS_READY (http://127\.0\.0\.1:([0-9]{1,5})/#/agent)\z");
        private readonly string statePath;
        private readonly bool openOnStartup;
        private readonly Label status = new Label();
        private readonly Button open = new Button();
        private readonly System.Windows.Forms.Timer startup = new System.Windows.Forms.Timer();
        private Process runtime;
        private string workbench;

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string profile = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (String.IsNullOrEmpty(profile) || !Path.IsPathRooted(profile))
            {
                MessageBox.Show("无法定位当前用户的 LocalAppData。", "Axis-Evo");
                return;
            }
            string state = Path.GetFullPath(Path.Combine(profile, "Axis-Evo", "Preview"));
            byte[] hash;
            using (var sha = SHA256.Create())
                hash = sha.ComputeHash(Encoding.UTF8.GetBytes(state.ToUpperInvariant()));
            using (var singleton = new Mutex(false, @"Local\AxisEvo-" + BitConverter.ToString(hash)))
            {
                bool owns;
                try { owns = singleton.WaitOne(0); }
                catch (AbandonedMutexException) { owns = true; }
                if (!owns)
                {
                    MessageBox.Show("Axis-Evo 已在运行。请使用已有的启动窗口打开工作台。", "Axis-Evo");
                    return;
                }
                try { Application.Run(new Launcher(state, Array.IndexOf(args, "--no-open") == -1)); }
                finally { singleton.ReleaseMutex(); }
            }
        }

        private Launcher(string state, bool autoOpen)
        {
            statePath = state;
            openOnStartup = autoOpen;
            Text = "Axis-Evo 0.1.0 Preview · M7";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Font;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            ClientSize = new Size(420, 166);

            status.SetBounds(20, 20, 380, 68);
            status.Text = "正在启动本地工作台…";
            open.SetBounds(20, 110, 130, 32);
            open.Text = "打开工作台";
            open.Enabled = false;
            open.Click += delegate { OpenWorkbench(); };
            var quit = new Button { Text = "退出 Axis-Evo" };
            quit.SetBounds(270, 110, 130, 32);
            quit.Click += delegate { Close(); };
            Controls.AddRange(new Control[] { status, open, quit });
            startup.Interval = 30000;
            startup.Tick += delegate
            {
                startup.Stop();
                if (workbench == null)
                {
                    status.Text = "启动超时。请查看当前用户 Axis-Evo/Preview 下的 startup.log。";
                    StopRuntime();
                }
            };
            Shown += delegate { StartRuntime(); };
            FormClosing += delegate { startup.Stop(); StopRuntime(); };
        }

        private void StartRuntime()
        {
            string install = AppDomain.CurrentDomain.BaseDirectory;
            try
            {
                Directory.CreateDirectory(statePath);
                var config = new ProcessStartInfo
                {
                    FileName = Path.Combine(install, "runtime", "python.exe"),
                    // Path.Combine supplies a fixed final segment and no trailing slash.
                    Arguments = "-B -X utf8 -m examples.windows_preview \"" + statePath + "\"",
                    WorkingDirectory = Path.Combine(install, "app"),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8
                };
                var child = new Process { StartInfo = config, EnableRaisingEvents = true };
                child.OutputDataReceived += (sender, evt) =>
                {
                    if (evt.Data != null) OnUi(() => AcceptReady(child, evt.Data));
                };
                child.ErrorDataReceived += (sender, evt) =>
                {
                    if (evt.Data != null) OnUi(() => LogStartup(child, evt.Data));
                };
                child.Exited += delegate
                {
                    OnUi(delegate
                    {
                        if (runtime != child) return;
                        startup.Stop();
                        open.Enabled = false;
                        status.Text = "本地工作台已停止。启动失败时，请查看 startup.log。";
                        workbench = null;
                    });
                };
                runtime = child;
                if (!child.Start()) throw new InvalidOperationException("Runtime did not start");
                child.BeginOutputReadLine();
                child.BeginErrorReadLine();
                startup.Start();
            }
            catch (Exception error)
            {
                LogStartup(runtime, error.GetType().Name);
                StopRuntime();
                status.Text = "无法启动本地工作台。请查看当前用户 Axis-Evo/Preview 下的 startup.log。";
            }
        }

        private void LogStartup(Process child, string line)
        {
            if (runtime != child || workbench != null) return;
            try
            {
                string path = Path.Combine(statePath, "startup.log");
                if (!File.Exists(path) || new FileInfo(path).Length < 65536)
                    File.AppendAllText(path, DateTime.UtcNow.ToString("O") + " " + line + "\n", Encoding.UTF8);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        private void OnUi(Action call)
        {
            try { if (IsHandleCreated && !IsDisposed) BeginInvoke(call); }
            catch (InvalidOperationException) { }
        }

        private void AcceptReady(Process child, string line)
        {
            if (runtime != child || child.HasExited || workbench != null) return;
            Match match = ReadyLine.Match(line);
            int port;
            if (!match.Success || !Int32.TryParse(match.Groups[2].Value, out port) || port < 1 || port > 65535)
                return;
            startup.Stop();
            workbench = match.Groups[1].Value;
            status.Text = "工作台已就绪。关闭此窗口会停止本地服务。";
            open.Enabled = true;
            if (openOnStartup) OpenWorkbench();
        }

        private void OpenWorkbench()
        {
            if (workbench == null) return;
            try { Process.Start(new ProcessStartInfo(workbench) { UseShellExecute = true }); }
            catch (Exception)
            {
                status.Text = "浏览器未能打开。请在浏览器中访问 " + workbench;
            }
        }

        private void StopRuntime()
        {
            Process child = runtime;
            runtime = null;
            if (child == null) return;
            try
            {
                if (child.HasExited) return;
                child.StandardInput.Close();
                if (!child.WaitForExit(8000))
                {
                    child.Kill();
                    child.WaitForExit(2000);
                }
            }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
            finally { child.Dispose(); }
        }
    }
}
