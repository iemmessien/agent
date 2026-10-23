"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WINDOWS_RECORD_SCRIPT = exports.MIN_VOICE_WAV_BYTES = void 0;
exports.isTooShortVoiceWav = isTooShortVoiceWav;
exports.powershellExe = powershellExe;
exports.detectVoiceBackend = detectVoiceBackend;
exports.voiceBackendInfo = voiceBackendInfo;
exports.materializeWindowsScript = materializeWindowsScript;
exports.fixRiffStreamingSizes = fixRiffStreamingSizes;
exports.startVoiceCapture = startVoiceCapture;
exports.voiceTempDir = voiceTempDir;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const log_1 = require("./log");
const log = (msg) => (0, log_1.logLine)('voice', msg);
/** Sub pragul ăsta înregistrarea e considerată prea scurtă (≈0,5 s la 16 kHz mono). */
exports.MIN_VOICE_WAV_BYTES = 44 + 16000 * 2 * 0.5;
function isTooShortVoiceWav(bytes) {
    return !Number.isFinite(bytes) || bytes < exports.MIN_VOICE_WAV_BYTES;
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function fileSize(p) {
    try {
        return fs.statSync(p).size;
    }
    catch {
        return 0;
    }
}
/** `where`/`which` pentru un program (best-effort). */
function whichProgram(name) {
    return new Promise((resolve) => {
        try {
            const cmd = process.platform === 'win32' ? 'where' : 'which';
            const child = (0, child_process_1.spawn)(cmd, [name], { windowsHide: true });
            let out = '';
            child.stdout?.on('data', (d) => (out += String(d)));
            child.on('error', () => resolve(undefined));
            child.on('close', (code) => {
                if (code !== 0)
                    return resolve(undefined);
                const first = out
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean)[0];
                resolve(first || undefined);
            });
        }
        catch {
            resolve(undefined);
        }
    });
}
/** Calea către Windows PowerShell 5.1 (mereu prezent pe Windows modern). */
function powershellExe() {
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const direct = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    try {
        if (fs.existsSync(direct))
            return direct;
    }
    catch {
        /* cădem pe PATH */
    }
    return 'powershell.exe';
}
let cachedBackend;
/**
 * Detectează backend-ul de captare: „windows-wavein” pe Windows (nativ,
 * fără dependențe), altfel „sox” dacă `rec`/`sox` există în PATH.
 */
async function detectVoiceBackend() {
    if (cachedBackend !== undefined)
        return cachedBackend;
    if (process.platform === 'win32') {
        cachedBackend = 'windows-wavein';
    }
    else {
        cachedBackend = (await whichProgram('rec')) || (await whichProgram('sox'))
            ? 'sox'
            : null;
    }
    log('backend detectat: ' + String(cachedBackend));
    return cachedBackend;
}
/** Descriere pentru Diagnostics. */
async function voiceBackendInfo() {
    const backend = await detectVoiceBackend();
    if (backend === 'windows-wavein') {
        return 'Native Windows — PowerShell + winmm (waveIn), zero external dependencies';
    }
    if (backend === 'sox') {
        return 'SoX (node-audiorecorder / `rec` from PATH)';
    }
    return 'UNAVAILABLE — Windows PowerShell is missing and SoX (`rec`/`sox`) is not installed';
}
/* =========================================================================
 * BACKEND 1 — WINDOWS NATIV (PowerShell + winmm waveIn, C# embebat)
 * ========================================================================= */
/**
 * Scriptul PowerShell (generat în folderul înregistrării). Parametrii vin
 * din Node: -OutFile, -StopFile, -MaxSeconds. La pornire scrie „READY” pe
 * stdout (abia după ce microfonul chiar s-a deschis); la oprire scrie
 * „STOPPED <bytes>”; erorile merg pe stderr cu prefixul „RECORDER ERROR:”.
 */
exports.WINDOWS_RECORD_SCRIPT = `param(
  [Parameter(Mandatory=$true)][string]$OutFile,
  [Parameter(Mandatory=$true)][string]$StopFile,
  [int]$Rate = 16000,
  [int]$Channels = 1,
  [int]$Bits = 16,
  [int]$MaxSeconds = 600,
  [int]$ChunkMs = 500
)
$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public sealed class FreekitWavRecorder : IDisposable
{
    private const int WAVE_MAPPER = -1;
    private const int WAVE_FORMAT_PCM = 1;
    private const int CALLBACK_FUNCTION = 0x00030000;
    private const int MM_WIM_DATA = 0x03C0;
    private const int WAVE_HEADER_BYTES = 44;

    [StructLayout(LayoutKind.Sequential)]
    private struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WAVEHDR
    {
        public IntPtr lpData;
        public uint dwBufferLength;
        public uint dwBytesRecorded;
        public IntPtr dwUser;
        public uint dwFlags;
        public uint dwLoops;
        public IntPtr lpNext;
        public IntPtr reserved;
    }

    private delegate void WaveInProc(IntPtr hwi, uint uMsg, IntPtr dwInstance, IntPtr dwParam1, IntPtr dwParam2);

    [DllImport("winmm.dll")]
    private static extern int waveInOpen(out IntPtr hwi, int uDeviceID, ref WAVEFORMATEX lpFormat, WaveInProc dwCallback, IntPtr dwInstance, int dwFlags);
    [DllImport("winmm.dll")]
    private static extern int waveInPrepareHeader(IntPtr hwi, IntPtr lpWaveInHdr, int uSize);
    [DllImport("winmm.dll")]
    private static extern int waveInUnprepareHeader(IntPtr hwi, IntPtr lpWaveInHdr, int uSize);
    [DllImport("winmm.dll")]
    private static extern int waveInAddBuffer(IntPtr hwi, IntPtr lpWaveInHdr, int uSize);
    [DllImport("winmm.dll")]
    private static extern int waveInStart(IntPtr hwi);
    [DllImport("winmm.dll")]
    private static extern int waveInStop(IntPtr hwi);
    [DllImport("winmm.dll")]
    private static extern int waveInReset(IntPtr hwi);
    [DllImport("winmm.dll")]
    private static extern int waveInClose(IntPtr hwi);

    private readonly int _rate;
    private readonly int _channels;
    private readonly int _bits;
    private readonly int _hdrSize;
    private FileStream _fs;
    private IntPtr _hwi = IntPtr.Zero;
    private IntPtr[] _headers;
    private IntPtr[] _buffers;
    private WaveInProc _callback;
    private int _pending;
    private readonly object _lock = new object();
    private volatile bool _stopping;
    private long _bytes;
    private bool _opened;
    private bool _stopped;

    public FreekitWavRecorder(string filePath, int rate, int channels, int bits, int chunkMs)
    {
        _rate = rate;
        _channels = channels;
        _bits = bits;
        _hdrSize = Marshal.SizeOf(typeof(WAVEHDR));
        _fs = new FileStream(filePath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
        WritePlaceholderHeader();

        int blockAlign = channels * bits / 8;
        long chunkBytes = (long)rate * blockAlign * Math.Max(20, chunkMs) / 1000;
        if (chunkBytes < blockAlign * 160L) chunkBytes = blockAlign * 160L;

        _headers = new IntPtr[4];
        _buffers = new IntPtr[4];
        for (int i = 0; i < 4; i++)
        {
            _buffers[i] = Marshal.AllocHGlobal((int)chunkBytes);
            WAVEHDR hdr = new WAVEHDR();
            hdr.lpData = _buffers[i];
            hdr.dwBufferLength = (uint)chunkBytes;
            _headers[i] = Marshal.AllocHGlobal(_hdrSize);
            Marshal.StructureToPtr(hdr, _headers[i], false);
        }
    }

    public long BytesRecorded
    {
        get { lock (_lock) { return _bytes; } }
    }

    public void Start()
    {
        WAVEFORMATEX fmt = new WAVEFORMATEX();
        fmt.wFormatTag = WAVE_FORMAT_PCM;
        fmt.nChannels = (ushort)_channels;
        fmt.nSamplesPerSec = (uint)_rate;
        fmt.wBitsPerSample = (ushort)_bits;
        fmt.nBlockAlign = (ushort)(_channels * _bits / 8);
        fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;
        fmt.cbSize = 0;

        _callback = new WaveInProc(OnWaveIn);
        int res = waveInOpen(out _hwi, WAVE_MAPPER, ref fmt, _callback, IntPtr.Zero, CALLBACK_FUNCTION);
        if (res != 0) throw new InvalidOperationException("waveInOpen: " + Describe(res));
        _opened = true;

        for (int i = 0; i < _headers.Length; i++)
        {
            res = waveInPrepareHeader(_hwi, _headers[i], _hdrSize);
            if (res != 0) throw new InvalidOperationException("waveInPrepareHeader: " + Describe(res));
            res = waveInAddBuffer(_hwi, _headers[i], _hdrSize);
            if (res != 0) throw new InvalidOperationException("waveInAddBuffer: " + Describe(res));
            lock (_lock) { _pending++; }
        }
        res = waveInStart(_hwi);
        if (res != 0) throw new InvalidOperationException("waveInStart: " + Describe(res));
    }

    private void OnWaveIn(IntPtr hwi, uint msg, IntPtr dwInstance, IntPtr dwParam1, IntPtr dwParam2)
    {
        if (msg != MM_WIM_DATA) return;
        try
        {
            WAVEHDR hdr = (WAVEHDR)Marshal.PtrToStructure(dwParam1, typeof(WAVEHDR));
            uint recorded = hdr.dwBytesRecorded;
            lock (_lock)
            {
                _pending--;
                if (recorded > 0 && _fs != null)
                {
                    byte[] chunk = new byte[(int)recorded];
                    Marshal.Copy(hdr.lpData, chunk, 0, (int)recorded);
                    _fs.Write(chunk, 0, chunk.Length);
                    _bytes += chunk.Length;
                }
            }
            if (!_stopping)
            {
                // ATENTIE: NU reseta dwFlags — contine WHDR_PREPARED, iar
                // waveInAddBuffer refuza (WAVERR_UNPREPARED) un header fara el.
                hdr.dwBytesRecorded = 0;
                Marshal.StructureToPtr(hdr, dwParam1, false);
                int res = waveInAddBuffer(hwi, dwParam1, _hdrSize);
                if (res == 0) { lock (_lock) { _pending++; } }
            }
        }
        catch
        {
            /* callback-ul nu are voie să propage excepții în codul nativ */
        }
    }

    public void Stop()
    {
        if (_stopped) return;
        _stopped = true;
        _stopping = true;

        if (_opened)
        {
            try { waveInStop(_hwi); } catch { }
            try { waveInReset(_hwi); } catch { }
            System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < 3000)
            {
                lock (_lock) { if (_pending <= 0) break; }
                Thread.Sleep(15);
            }
            for (int i = 0; i < _headers.Length; i++)
            {
                try { waveInUnprepareHeader(_hwi, _headers[i], _hdrSize); } catch { }
            }
            try { waveInClose(_hwi); } catch { }
            _opened = false;
        }

        lock (_lock)
        {
            if (_fs != null)
            {
                long dataLen = _fs.Length - WAVE_HEADER_BYTES;
                if (dataLen < 0) dataLen = 0;
                _fs.Seek(4, SeekOrigin.Begin);
                WriteUInt32((uint)Math.Min(dataLen + 36L, 4294967295L));
                _fs.Seek(40, SeekOrigin.Begin);
                WriteUInt32((uint)Math.Min(dataLen, 4294967295L));
                _fs.Flush();
                _fs.Close();
                _fs = null;
            }
        }
        FreeBuffers();
    }

    public void Dispose()
    {
        try { Stop(); } catch { }
        FreeBuffers();
    }

    private void FreeBuffers()
    {
        if (_buffers != null)
        {
            for (int i = 0; i < _buffers.Length; i++)
            {
                if (_buffers[i] != IntPtr.Zero) { try { Marshal.FreeHGlobal(_buffers[i]); } catch { } _buffers[i] = IntPtr.Zero; }
                if (_headers != null && _headers[i] != IntPtr.Zero) { try { Marshal.FreeHGlobal(_headers[i]); } catch { } _headers[i] = IntPtr.Zero; }
            }
        }
    }

    private void WritePlaceholderHeader()
    {
        byte[] h = new byte[WAVE_HEADER_BYTES];
        CopyAscii(h, 0, "RIFF");
        WriteLE(h, 4, 36);
        CopyAscii(h, 8, "WAVE");
        CopyAscii(h, 12, "fmt ");
        WriteLE(h, 16, 16);
        WriteLE16(h, 20, 1);
        WriteLE16(h, 22, (uint)_channels);
        WriteLE(h, 24, (uint)_rate);
        WriteLE(h, 28, (uint)(_rate * _channels * _bits / 8));
        WriteLE16(h, 32, (uint)(_channels * _bits / 8));
        WriteLE16(h, 34, (uint)_bits);
        CopyAscii(h, 36, "data");
        WriteLE(h, 40, 0);
        _fs.Write(h, 0, h.Length);
    }

    private static void CopyAscii(byte[] buf, int off, string s)
    {
        for (int i = 0; i < s.Length; i++) buf[off + i] = (byte)s[i];
    }

    private static void WriteLE(byte[] buf, int off, uint v)
    {
        buf[off] = (byte)(v & 0xFF);
        buf[off + 1] = (byte)((v >> 8) & 0xFF);
        buf[off + 2] = (byte)((v >> 16) & 0xFF);
        buf[off + 3] = (byte)((v >> 24) & 0xFF);
    }

    private static void WriteLE16(byte[] buf, int off, uint v)
    {
        buf[off] = (byte)(v & 0xFF);
        buf[off + 1] = (byte)((v >> 8) & 0xFF);
    }

    private void WriteUInt32(uint v)
    {
        byte[] b = new byte[4];
        b[0] = (byte)(v & 0xFF);
        b[1] = (byte)((v >> 8) & 0xFF);
        b[2] = (byte)((v >> 16) & 0xFF);
        b[3] = (byte)((v >> 24) & 0xFF);
        _fs.Write(b, 0, 4);
    }

    private static string Describe(int code)
    {
        switch (code)
        {
            case 1: return "audio internal error (1)";
            case 2: return "invalid device ID (2)";
            case 4: return "the device is already in use by another program (4)";
            case 5: return "invalid handle (5)";
            case 6: return "no recording device found (6) - connect a microphone";
            case 7: return "out of memory (7)";
            case 8: return "function not supported (8)";
            case 11: return "invalid parameter (11)";
            case 32: return "unsupported audio format (32)";
            case 33: return "the recorder is already running (33)";
            case 34: return "buffer not prepared (34)";
            default: return "code " + code;
        }
    }
}
'@

try {
  Add-Type -TypeDefinition $source -Language CSharp | Out-Null
} catch {
  [Console]::Error.WriteLine('RECORDER ERROR: failed to compile the recorder: ' + $_.Exception.Message)
  exit 2
}

$rec = New-Object FreekitWavRecorder($OutFile, $Rate, $Channels, $Bits, $ChunkMs)
try {
  $rec.Start()
  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while (-not (Test-Path -LiteralPath $StopFile)) {
    if ($sw.Elapsed.TotalSeconds -ge $MaxSeconds) { break }
    Start-Sleep -Milliseconds 100
  }

  $rec.Stop()
  [Console]::Out.WriteLine('STOPPED ' + $rec.BytesRecorded)
  [Console]::Out.Flush()
  exit 0
} catch {
  [Console]::Error.WriteLine('RECORDER ERROR: ' + $_.Exception.Message)
  try { $rec.Stop() } catch { }
  exit 1
} finally {
  try { $rec.Dispose() } catch { }
}
`;
/** Scrie scriptul PowerShell în folderul captării (o dată per sesiune). */
function materializeWindowsScript(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const scriptPath = path.join(dir, 'record.ps1');
    fs.writeFileSync(scriptPath, exports.WINDOWS_RECORD_SCRIPT, 'utf8');
    return scriptPath;
}
class WindowsCapture {
    kind = 'windows-wavein';
    startedAt = Date.now();
    onAutoStop;
    child;
    stopFile;
    outFile;
    stdout = '';
    stderr = '';
    readyReached = false;
    exitCode = null;
    exited = false;
    stopRequested = false;
    aborted = false;
    stopPromise = null;
    exitPromise;
    resolveExit;
    rejectReady;
    readyPromise;
    resolveReady;
    constructor(opts) {
        this.outFile = opts.outFile;
        this.stopFile = opts.stopFile;
        this.child = (0, child_process_1.spawn)(powershellExe(), [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            opts.scriptPath,
            '-OutFile',
            opts.outFile,
            '-StopFile',
            opts.stopFile,
            '-MaxSeconds',
            String(opts.maxSeconds)
        ], { windowsHide: true });
        this.exitPromise = new Promise((r) => (this.resolveExit = r));
        this.readyPromise = new Promise((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        const onChunk = (d) => {
            this.stdout += String(d);
            if (!this.readyReached && /(^|\r?\n)READY\b/.test(this.stdout)) {
                this.readyReached = true;
                this.resolveReady();
            }
        };
        this.child.stdout?.on('data', onChunk);
        this.child.stderr?.on('data', (d) => (this.stderr += String(d)));
        this.child.on('error', (e) => {
            // najungem niciodată la READY (ex: powershell.exe lipsește)
            const err = new Error('PowerShell failed to start: ' + (e?.message ?? String(e)));
            if (!this.readyReached) {
                this.rejectReady(err);
            }
            this.stderr += String(e?.message ?? e);
        });
        this.child.on('close', (code) => {
            this.exitCode = code;
            this.exited = true;
            this.resolveExit();
            if (!this.readyReached) {
                this.rejectReady(new Error('Recorder stopped before READY (code ' +
                    code +
                    ')' +
                    (this.stderrTail() ? ': ' + this.stderrTail() : '')));
            }
            // auto-oprire (durata maximă atinsă) sau proces mort neașteptat
            if (!this.stopRequested && !this.aborted && this.onAutoStop) {
                const cb = this.onAutoStop;
                this.onAutoStop = undefined;
                cb(this.buildResult());
            }
        });
    }
    statusLine() {
        const m = /STOPPED\s+(\d+)/.exec(this.stdout);
        return m ? m[1] : undefined;
    }
    stderrTail() {
        const t = this.stderr.trim();
        return t.length > 400 ? t.slice(-400) : t;
    }
    buildResult() {
        const bytes = fileSize(this.outFile);
        const ok = this.readyReached && this.exitCode === 0 && bytes > 44;
        let error;
        if (!ok) {
            if (!this.readyReached) {
                error = 'the microphone did not start' + (this.stderrTail() ? ' — ' + this.stderrTail() : '');
            }
            else if (this.exitCode !== 0) {
                error =
                    'the recorder exited with code ' + this.exitCode + (this.stderrTail() ? ' — ' + this.stderrTail() : '');
            }
            else {
                error = 'the audio file was not written';
            }
        }
        return {
            ok,
            file: this.outFile,
            bytes,
            durationMs: Date.now() - this.startedAt,
            backend: this.kind,
            error
        };
    }
    async waitReady(timeoutMs = 20000) {
        const timeout = delay(timeoutMs).then(() => {
            if (!this.readyReached) {
                this.aborted = true;
                try {
                    this.child.kill();
                }
                catch {
                    /* procesul poate fi deja încheiat */
                }
                throw new Error('Microphone startup timed out (' + timeoutMs + ' ms).');
            }
        });
        await Promise.race([this.readyPromise, timeout]);
    }
    stop() {
        if (!this.stopPromise) {
            this.stopPromise = (async () => {
                this.stopRequested = true;
                try {
                    fs.writeFileSync(this.stopFile, '1');
                }
                catch {
                    /* dacă nu putem scrie sentinela, rămâne kill-ul de mai jos */
                }
                const finished = await Promise.race([
                    this.exitPromise.then(() => true),
                    delay(10000).then(() => false)
                ]);
                if (!finished) {
                    log('voice: recorderul nu a răspuns la stop — îl omor');
                    try {
                        this.child.kill();
                    }
                    catch {
                        /* ignoră */
                    }
                    await Promise.race([this.exitPromise, delay(2000)]);
                }
                return this.buildResult();
            })();
        }
        return this.stopPromise;
    }
    async abort() {
        this.aborted = true;
        this.stopRequested = true;
        try {
            fs.writeFileSync(this.stopFile, '1');
        }
        catch {
            /* ignoră */
        }
        try {
            this.child.kill();
        }
        catch {
            /* ignoră */
        }
    }
}
/* =========================================================================
 * BACKEND 2 — SoX via node-audiorecorder (cross-platform, când e disponibil)
 * ========================================================================= */
/**
 * Un WAV scris în pipe/stream are dimensiunile RIFF setate pe „streaming”
 * (0xFFFFFFFF sau 0) pentru că SoX nu poate face seek înapoi. Reparăm în
 * buffer dimensiunile reale (funcție pură — testabilă).
 */
function fixRiffStreamingSizes(buf) {
    try {
        if (buf.length < 44)
            return null;
        if (buf.toString('ascii', 0, 4) !== 'RIFF')
            return null;
        if (buf.toString('ascii', 8, 12) !== 'WAVE')
            return null;
        let off = 12;
        let dataOffset = -1;
        while (off + 8 <= buf.length) {
            const id = buf.toString('ascii', off, off + 4);
            const size = buf.readUInt32LE(off + 4);
            if (id === 'data') {
                dataOffset = off + 8;
                break;
            }
            const next = off + 8 + size + (size % 2);
            if (next <= off || next > buf.length)
                return null; // chunk cu dimensiune nerezonabilă
            off = next;
        }
        if (dataOffset < 0)
            return null;
        const dataSize = buf.length - dataOffset;
        const riffSize = Math.min(buf.length - 8, 0xffffffff);
        const changed = buf.readUInt32LE(4) !== riffSize || buf.readUInt32LE(dataOffset - 4) !== dataSize;
        buf.writeUInt32LE(riffSize, 4);
        buf.writeUInt32LE(Math.min(dataSize, 0xffffffff), dataOffset - 4);
        return { dataOffset, dataSize, changed };
    }
    catch {
        return null;
    }
}
class SoxCapture {
    outFile;
    kind = 'sox';
    startedAt = Date.now();
    onAutoStop;
    recorder;
    ws;
    firstError = null;
    stopPromise = null;
    aborted = false;
    constructor(outFile) {
        this.outFile = outFile;
        // require lazy: node-audiorecorder e CJS fără tipuri
        const AudioRecorder = require('node-audiorecorder');
        this.recorder = new AudioRecorder({
            program: 'rec',
            device: null,
            bits: 16,
            channels: 1,
            encoding: 'signed-integer',
            rate: 16000,
            type: 'wav',
            silence: 0,
            keepSilence: true
        }, undefined);
        this.recorder.on('error', (e) => {
            this.firstError = e instanceof Error ? e : new Error(String(e));
        });
        this.recorder.start();
        const stream = this.recorder.stream();
        if (!stream) {
            throw new Error('node-audiorecorder could not start (SoX / `rec` is missing).');
        }
        this.ws = fs.createWriteStream(outFile);
        stream.pipe(this.ws);
    }
    async waitReady() {
        await delay(1500);
        if (this.firstError) {
            throw new Error('SoX / `rec` failed to start: ' + this.firstError.message);
        }
    }
    stop() {
        if (!this.stopPromise) {
            this.stopPromise = (async () => {
                try {
                    this.recorder.stop();
                }
                catch {
                    /* ignoră */
                }
                await new Promise((resolve) => {
                    const t = setTimeout(resolve, 6000);
                    this.ws.once('close', () => {
                        clearTimeout(t);
                        resolve();
                    });
                });
                // repară header-ul RIFF „streaming” scris de SoX în pipe
                try {
                    const buf = fs.readFileSync(this.outFile);
                    fixRiffStreamingSizes(buf);
                    fs.writeFileSync(this.outFile, buf);
                }
                catch {
                    /* best-effort */
                }
                const bytes = fileSize(this.outFile);
                const ok = !this.firstError && bytes > 44;
                return {
                    ok,
                    file: this.outFile,
                    bytes,
                    durationMs: Date.now() - this.startedAt,
                    backend: this.kind,
                    error: ok
                        ? undefined
                        : this.firstError
                            ? 'SoX / `rec`: ' + this.firstError.message
                            : 'the audio file was not written'
                };
            })();
        }
        return this.stopPromise;
    }
    async abort() {
        this.aborted = true;
        try {
            this.recorder.stop();
        }
        catch {
            /* ignoră */
        }
        try {
            this.ws.end();
        }
        catch {
            /* ignoră */
        }
    }
}
/**
 * Pornește captarea audio în Extension Host. Rezolvă DOAR după ce microfonul
 * chiar s-a deschis (backend-ul Windows scrie „READY” la acel moment).
 */
async function startVoiceCapture(opts) {
    const backend = await detectVoiceBackend();
    if (!backend) {
        throw new Error('No audio capture backend found: Windows PowerShell (native) or SoX (`rec`/`sox` in PATH) were not found.');
    }
    const maxSeconds = Math.max(5, Math.min(3600, Math.floor(opts.maxSeconds ?? 600)));
    fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
    opts.onLog?.('pornesc captarea (' + backend + ') → ' + opts.outFile);
    if (backend === 'windows-wavein') {
        const scriptPath = materializeWindowsScript(path.dirname(opts.outFile));
        const stopFile = path.join(path.dirname(opts.outFile), 'stop.signal');
        const cap = new WindowsCapture({
            outFile: opts.outFile,
            scriptPath,
            stopFile,
            maxSeconds
        });
        try {
            await cap.waitReady();
            opts.onLog?.('microfon deschis (winmm)');
            return cap;
        }
        catch (e) {
            void cap.abort();
            throw e;
        }
    }
    const cap = new SoxCapture(opts.outFile);
    try {
        await cap.waitReady();
        opts.onLog?.('microfon deschis (SoX)');
        return cap;
    }
    catch (e) {
        void cap.abort();
        throw e;
    }
}
/** Folderul temporar standard pentru înregistrări. */
function voiceTempDir() {
    return path.join(os.tmpdir(), 'freekit-voice');
}
//# sourceMappingURL=voiceRecorder.js.map