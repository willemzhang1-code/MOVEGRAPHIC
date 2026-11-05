using System;

namespace Rabbit
{
    /// <summary>Immutable skeleton data (bones, slots, skins, animations) loaded once and shared by instances.</summary>
    public sealed unsafe class RabbitSkeletonData : IDisposable
    {
        internal IntPtr Ptr;

        public string[] Bones { get; private set; }
        public int[] BoneParents { get; private set; }
        public float[] BoneLengths { get; private set; }
        public string[] Slots { get; private set; }
        public string[] Skins { get; private set; }
        public string[] Animations { get; private set; }
        public float[] AnimationDurations { get; private set; }
        public string[] Events { get; private set; }
        /// <summary>Atlas page image names, in atlas order.</summary>
        public string[] Pages { get; private set; }
        public bool[] PagePremultiplied { get; private set; }
        /// <summary>Non-fatal import issues (unsupported features, missing regions).</summary>
        public string[] Warnings { get; private set; }

        RabbitSkeletonData(IntPtr ptr)
        {
            Ptr = ptr;
            Bones = Names(RabbitNative.KindBones);
            Slots = Names(RabbitNative.KindSlots);
            Skins = Names(RabbitNative.KindSkins);
            Animations = Names(RabbitNative.KindAnimations);
            Events = Names(RabbitNative.KindEvents);
            Pages = Names(RabbitNative.KindPages);
            Warnings = Names(RabbitNative.KindWarnings);
            BoneParents = new int[Bones.Length];
            BoneLengths = new float[Bones.Length];
            for (uint i = 0; i < Bones.Length; i++)
            {
                BoneParents[i] = RabbitNative.sinew_data_bone_parent(ptr, i);
                BoneLengths[i] = RabbitNative.sinew_data_bone_length(ptr, i);
            }
            AnimationDurations = new float[Animations.Length];
            for (uint i = 0; i < Animations.Length; i++) AnimationDurations[i] = RabbitNative.sinew_data_animation_duration(ptr, i);
            PagePremultiplied = new bool[Pages.Length];
            for (uint i = 0; i < Pages.Length; i++) PagePremultiplied[i] = RabbitNative.sinew_data_page_pma(ptr, i) != 0;
        }

        /// <summary>Loads Spine 4.x / RABBIT JSON and a libGDX text atlas (may be empty).</summary>
        public static RabbitSkeletonData Load(string json, string atlas)
        {
            var j = System.Text.Encoding.UTF8.GetBytes(json ?? "");
            var a = System.Text.Encoding.UTF8.GetBytes(atlas ?? "");
            IntPtr p;
            fixed (byte* jp = j)
            fixed (byte* ap = a)
                p = RabbitNative.sinew_data_load_spine(jp, (UIntPtr)j.Length, ap, (UIntPtr)a.Length);
            if (p == IntPtr.Zero) throw new FormatException("RABBIT: " + RabbitNative.LastError());
            return new RabbitSkeletonData(p);
        }

        public int FindBone(string name) => Array.IndexOf(Bones, name);
        public int FindAnimation(string name) => Array.IndexOf(Animations, name);

        string[] Names(uint kind)
        {
            uint n = RabbitNative.sinew_data_count(Ptr, kind);
            var r = new string[n];
            for (uint i = 0; i < n; i++)
            {
                byte* s = RabbitNative.sinew_data_name(Ptr, kind, i, out UIntPtr len);
                r[i] = RabbitNative.Utf8(s, len);
            }
            return r;
        }

        public RabbitInstance CreateInstance() => new RabbitInstance(this);

        public void Dispose()
        {
            if (Ptr != IntPtr.Zero) RabbitNative.sinew_data_free(Ptr);
            Ptr = IntPtr.Zero;
            GC.SuppressFinalize(this);
        }

        ~RabbitSkeletonData()
        {
            if (Ptr != IntPtr.Zero) RabbitNative.sinew_data_free(Ptr);
        }
    }
}
