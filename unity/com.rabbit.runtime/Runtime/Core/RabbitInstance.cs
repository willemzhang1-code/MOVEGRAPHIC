using System;
using System.Collections.Generic;

namespace Rabbit
{
    public enum RabbitBlend { Normal = 0, Additive = 1, Multiply = 2, Screen = 3 }

    public enum RabbitEventKind { Start = 0, Interrupt = 1, End = 2, Complete = 3, Event = 4 }

    public struct RabbitEvent
    {
        public int Track;
        public RabbitEventKind Kind;
        public int Entry;
        /// <summary>Event name for <see cref="RabbitEventKind.Event"/>, else null.</summary>
        public string Name;
        public int Int;
        public float Float;
        public float Volume;
        public float Balance;
    }

    /// <summary>
    /// Render output of one frame. Vertices are interleaved 6 x 32-bit words:
    /// x, y, u, v (float bits), light RGBA8, dark RGB8 (two-color tint, alpha unused).
    /// Indices are triangles; batches split them by atlas page and blend mode.
    /// </summary>
    public sealed class RabbitRenderData
    {
        public const int VertexWords = 6;
        public uint[] Vertices = new uint[0];
        public int VertexCount;
        public uint[] Indices = new uint[0];
        public int IndexCount;
        public readonly List<RenderBatch> Batches = new List<RenderBatch>();

        public float X(int v) => BitConverter.Int32BitsToSingle((int)Vertices[v * VertexWords]);
        public float Y(int v) => BitConverter.Int32BitsToSingle((int)Vertices[v * VertexWords + 1]);
        public float U(int v) => BitConverter.Int32BitsToSingle((int)Vertices[v * VertexWords + 2]);
        public float V(int v) => BitConverter.Int32BitsToSingle((int)Vertices[v * VertexWords + 3]);
        public uint Light(int v) => Vertices[v * VertexWords + 4];
        public uint Dark(int v) => Vertices[v * VertexWords + 5];
    }

    /// <summary>A posed skeleton with an animation state (tracks, crossfades, events, physics).</summary>
    public sealed unsafe class RabbitInstance : IDisposable
    {
        public readonly RabbitSkeletonData Data;
        IntPtr ptr;

        internal RabbitInstance(RabbitSkeletonData data)
        {
            Data = data;
            ptr = RabbitNative.sinew_instance_new(data.Ptr);
        }

        IntPtr P
        {
            get
            {
                if (ptr == IntPtr.Zero) throw new ObjectDisposedException(nameof(RabbitInstance));
                return ptr;
            }
        }

        public void SetTransform(float x, float y, float scaleX = 1, float scaleY = 1) => RabbitNative.sinew_instance_set_transform(P, x, y, scaleX, scaleY);
        public void SetColor(float r, float g, float b, float a = 1) => RabbitNative.sinew_instance_set_color(P, r, g, b, a);

        public bool SetSkin(string name)
        {
            var s = new Utf8Arg(name);
            fixed (byte* b = s.Bytes) return RabbitNative.sinew_instance_set_skin(P, b, s.Len) != 0;
        }

        /// <summary>Sets the current animation of a track (crossfading from the previous one). Returns the entry id.</summary>
        public int SetAnimation(int track, string name, bool loop)
        {
            var s = new Utf8Arg(name);
            uint id;
            fixed (byte* b = s.Bytes) id = RabbitNative.sinew_instance_set_animation(P, (uint)track, b, s.Len, loop ? 1u : 0u);
            if (id == 0) throw new ArgumentException("RABBIT: animation not found: " + name);
            return (int)id;
        }

        /// <summary>Queues an animation after the current one (delay &lt;= 0: relative to its end).</summary>
        public int AddAnimation(int track, string name, bool loop, float delay = 0)
        {
            var s = new Utf8Arg(name);
            uint id;
            fixed (byte* b = s.Bytes) id = RabbitNative.sinew_instance_add_animation(P, (uint)track, b, s.Len, loop ? 1u : 0u, delay);
            if (id == 0) throw new ArgumentException("RABBIT: animation not found: " + name);
            return (int)id;
        }

        public int SetEmptyAnimation(int track, float mix) => (int)RabbitNative.sinew_instance_set_empty_animation(P, (uint)track, mix);
        public int AddEmptyAnimation(int track, float mix, float delay = 0) => (int)RabbitNative.sinew_instance_add_empty_animation(P, (uint)track, mix, delay);
        public void ClearTrack(int track) => RabbitNative.sinew_instance_clear_track(P, (uint)track);
        public void SetDefaultMix(float seconds) => RabbitNative.sinew_instance_set_default_mix(P, seconds);

        public bool SetMix(string from, string to, float seconds)
        {
            var a = new Utf8Arg(from);
            var b = new Utf8Arg(to);
            fixed (byte* pa = a.Bytes)
            fixed (byte* pb = b.Bytes)
                return RabbitNative.sinew_instance_set_mix(P, pa, a.Len, pb, b.Len, seconds) != 0;
        }

        public void SetTrackAlpha(int track, float alpha) => RabbitNative.sinew_instance_set_track_alpha(P, (uint)track, alpha);
        public void SetTrackAdditive(int track, bool additive) => RabbitNative.sinew_instance_set_track_additive(P, (uint)track, additive ? 1u : 0u);
        public void Seek(int track, float time) => RabbitNative.sinew_instance_seek(P, (uint)track, time);
        public float TrackTime(int track) => RabbitNative.sinew_instance_track_time(P, (uint)track);
        public float TimeScale { set => RabbitNative.sinew_instance_set_time_scale(P, value); }

        /// <summary>Advances animations and physics by dt seconds and poses the skeleton.</summary>
        public void Update(double dt) => RabbitNative.sinew_instance_update(P, dt);

        /// <summary>Restarts physics from the current pose (after teleporting the skeleton).</summary>
        public void ResetPhysics() => RabbitNative.sinew_instance_reset_physics(P);

        /// <summary>Builds the frame's geometry into <paramref name="into"/> (arrays grow as needed).</summary>
        public void Render(RabbitRenderData into)
        {
            uint n = RabbitNative.sinew_instance_render(P);
            uint* v = RabbitNative.sinew_instance_vertices(P, out UIntPtr vl);
            int words = (int)vl;
            if (into.Vertices.Length < words) into.Vertices = new uint[Math.Max(words, into.Vertices.Length * 2)];
            fixed (uint* dst = into.Vertices) Buffer.MemoryCopy(v, dst, (long)into.Vertices.Length * 4, (long)words * 4);
            into.VertexCount = words / RabbitRenderData.VertexWords;

            uint* idx = RabbitNative.sinew_instance_indices(P, out UIntPtr il);
            int ic = (int)il;
            if (into.Indices.Length < ic) into.Indices = new uint[Math.Max(ic, into.Indices.Length * 2)];
            fixed (uint* dst = into.Indices) Buffer.MemoryCopy(idx, dst, (long)into.Indices.Length * 4, (long)ic * 4);
            into.IndexCount = ic;

            RenderBatch* bp = RabbitNative.sinew_instance_batches(P, out UIntPtr bl);
            into.Batches.Clear();
            for (int i = 0; i < (int)bl && i < n; i++) into.Batches.Add(bp[i]);
        }

        /// <summary>World transform of a bone: (a, b, c, d, x, y) in skeleton space (y up).</summary>
        public bool BoneWorld(int bone, out float a, out float b, out float c, out float d, out float x, out float y)
        {
            float* w = RabbitNative.sinew_instance_bone_world(P, out UIntPtr len);
            int o = bone * 7;
            if (bone < 0 || o + 6 >= (int)len)
            {
                a = d = 1; b = c = x = y = 0;
                return false;
            }
            a = w[o]; b = w[o + 1]; c = w[o + 2]; d = w[o + 3]; x = w[o + 4]; y = w[o + 5];
            return w[o + 6] != 0;
        }

        /// <summary>Drains the state events produced since the last call.</summary>
        public void PollEvents(List<RabbitEvent> into)
        {
            float* f = RabbitNative.sinew_instance_poll_events(P, out UIntPtr len);
            int n = (int)len;
            for (int i = 0; i + 7 < n; i += 8)
            {
                var kind = (RabbitEventKind)(int)f[i + 1];
                int ev = (int)f[i + 3];
                into.Add(new RabbitEvent
                {
                    Track = (int)f[i],
                    Kind = kind,
                    Entry = (int)f[i + 2],
                    Name = kind == RabbitEventKind.Event && ev >= 0 && ev < Data.Events.Length ? Data.Events[ev] : null,
                    Int = (int)f[i + 4],
                    Float = f[i + 5],
                    Volume = f[i + 6],
                    Balance = f[i + 7],
                });
            }
        }

        public void Dispose()
        {
            if (ptr != IntPtr.Zero) RabbitNative.sinew_instance_free(ptr);
            ptr = IntPtr.Zero;
            GC.SuppressFinalize(this);
        }

        ~RabbitInstance()
        {
            if (ptr != IntPtr.Zero) RabbitNative.sinew_instance_free(ptr);
        }
    }
}
