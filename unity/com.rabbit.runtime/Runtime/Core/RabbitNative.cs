// P/Invoke bindings for the RABBIT core C ABI (crates/sinew-ffi).
// Strings are passed as UTF-8 (pointer, length) without terminator; returned
// pointers stay valid until the next call that mutates the same handle.
using System;
using System.Runtime.InteropServices;

namespace Rabbit
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RenderBatch
    {
        public uint Page;
        public uint Blend;
        public uint FirstIndex;
        public uint IndexCount;
    }

    internal static unsafe class RabbitNative
    {
#if (UNITY_IOS || UNITY_WEBGL) && !UNITY_EDITOR
        const string Lib = "__Internal";
#else
        const string Lib = "sinew_ffi";
#endif

        public const uint KindBones = 0, KindSlots = 1, KindSkins = 2, KindAnimations = 3, KindEvents = 4, KindPages = 5, KindWarnings = 6;

        [DllImport(Lib)] public static extern uint sinew_version();
        [DllImport(Lib)] public static extern byte* sinew_last_error(out UIntPtr len);

        [DllImport(Lib)] public static extern IntPtr sinew_data_load_spine(byte* json, UIntPtr jsonLen, byte* atlas, UIntPtr atlasLen);
        [DllImport(Lib)] public static extern void sinew_data_free(IntPtr d);
        [DllImport(Lib)] public static extern uint sinew_data_count(IntPtr d, uint kind);
        [DllImport(Lib)] public static extern byte* sinew_data_name(IntPtr d, uint kind, uint index, out UIntPtr len);
        [DllImport(Lib)] public static extern int sinew_data_bone_parent(IntPtr d, uint index);
        [DllImport(Lib)] public static extern float sinew_data_bone_length(IntPtr d, uint index);
        [DllImport(Lib)] public static extern float sinew_data_animation_duration(IntPtr d, uint index);
        [DllImport(Lib)] public static extern uint sinew_data_page_pma(IntPtr d, uint index);

        [DllImport(Lib)] public static extern IntPtr sinew_instance_new(IntPtr d);
        [DllImport(Lib)] public static extern void sinew_instance_free(IntPtr i);
        [DllImport(Lib)] public static extern void sinew_instance_set_transform(IntPtr i, float x, float y, float scaleX, float scaleY);
        [DllImport(Lib)] public static extern void sinew_instance_set_color(IntPtr i, float r, float g, float b, float a);
        [DllImport(Lib)] public static extern uint sinew_instance_set_skin(IntPtr i, byte* name, UIntPtr len);
        [DllImport(Lib)] public static extern uint sinew_instance_set_animation(IntPtr i, uint track, byte* name, UIntPtr len, uint loop);
        [DllImport(Lib)] public static extern uint sinew_instance_add_animation(IntPtr i, uint track, byte* name, UIntPtr len, uint loop, float delay);
        [DllImport(Lib)] public static extern uint sinew_instance_set_empty_animation(IntPtr i, uint track, float mix);
        [DllImport(Lib)] public static extern uint sinew_instance_add_empty_animation(IntPtr i, uint track, float mix, float delay);
        [DllImport(Lib)] public static extern void sinew_instance_clear_track(IntPtr i, uint track);
        [DllImport(Lib)] public static extern void sinew_instance_set_default_mix(IntPtr i, float duration);
        [DllImport(Lib)] public static extern uint sinew_instance_set_mix(IntPtr i, byte* from, UIntPtr fromLen, byte* to, UIntPtr toLen, float duration);
        [DllImport(Lib)] public static extern void sinew_instance_set_track_alpha(IntPtr i, uint track, float alpha);
        [DllImport(Lib)] public static extern void sinew_instance_set_track_additive(IntPtr i, uint track, uint additive);
        [DllImport(Lib)] public static extern void sinew_instance_seek(IntPtr i, uint track, float time);
        [DllImport(Lib)] public static extern float sinew_instance_track_time(IntPtr i, uint track);
        [DllImport(Lib)] public static extern void sinew_instance_set_time_scale(IntPtr i, float timeScale);
        [DllImport(Lib)] public static extern void sinew_instance_update(IntPtr i, double dt);
        [DllImport(Lib)] public static extern void sinew_instance_reset_physics(IntPtr i);
        [DllImport(Lib)] public static extern uint sinew_instance_render(IntPtr i);
        [DllImport(Lib)] public static extern uint* sinew_instance_vertices(IntPtr i, out UIntPtr len);
        [DllImport(Lib)] public static extern uint* sinew_instance_indices(IntPtr i, out UIntPtr len);
        [DllImport(Lib)] public static extern RenderBatch* sinew_instance_batches(IntPtr i, out UIntPtr len);
        [DllImport(Lib)] public static extern float* sinew_instance_bone_world(IntPtr i, out UIntPtr len);
        [DllImport(Lib)] public static extern float* sinew_instance_poll_events(IntPtr i, out UIntPtr len);

        public static string Utf8(byte* p, UIntPtr len)
        {
            int n = (int)len;
            return n == 0 || p == null ? "" : System.Text.Encoding.UTF8.GetString(p, n);
        }

        public static string LastError()
        {
            byte* p = sinew_last_error(out UIntPtr len);
            return Utf8(p, len);
        }
    }

    /// <summary>Pins a string as UTF-8 for one native call.</summary>
    internal readonly ref struct Utf8Arg
    {
        public readonly byte[] Bytes;
        public Utf8Arg(string s) { Bytes = System.Text.Encoding.UTF8.GetBytes(s ?? ""); }
        public UIntPtr Len => (UIntPtr)Bytes.Length;
    }
}
