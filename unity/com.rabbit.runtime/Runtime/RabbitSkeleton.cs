using System;
using System.Collections.Generic;
using UnityEngine;

namespace Rabbit
{
    /// <summary>Plays a RABBIT skeleton and draws it with a MeshRenderer (one submesh per atlas page / blend mode).</summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    [AddComponentMenu("RABBIT/Skeleton")]
    public sealed class RabbitSkeleton : MonoBehaviour
    {
        public RabbitSkeletonAsset skeletonAsset;
        public string animationName;
        public bool loop = true;
        public string skin;
        [Min(0)] public float timeScale = 1;
        public Color color = Color.white;
        [Tooltip("Advance animation in edit mode (preview).")]
        public bool previewInEditor = true;
        [Tooltip("Shader used for page materials. Defaults to RABBIT/Skeleton.")]
        public Shader shader;

        /// <summary>Animation state events: start, interrupt, end, complete and keyed events.</summary>
        public event Action<RabbitSkeleton, RabbitEvent> AnimationEvent;

        public RabbitInstance Instance { get; private set; }
        public RabbitSkeletonData Data => Instance?.Data;

        readonly RabbitRenderData render = new RabbitRenderData();
        readonly List<RabbitEvent> events = new List<RabbitEvent>();
        readonly List<Vector3> positions = new List<Vector3>();
        readonly List<Vector2> uvs = new List<Vector2>();
        readonly List<Color32> lights = new List<Color32>();
        readonly List<Vector3> darks = new List<Vector3>();
        readonly List<int> tris = new List<int>();
        readonly Dictionary<(Texture, int, bool), Material> materials = new Dictionary<(Texture, int, bool), Material>();
        readonly List<Material> frameMaterials = new List<Material>();
        Mesh mesh;
        string playing;
        bool playingLoop;
        string appliedSkin;
        RabbitSkeletonAsset loadedAsset;
#if UNITY_EDITOR
        double lastEditorTime;
#endif

        void OnEnable() => Initialize();

        void OnDisable() => Release();

        void OnValidate()
        {
            if (isActiveAndEnabled && (skeletonAsset != loadedAsset || Instance == null)) Initialize();
        }

        /// <summary>(Re)creates the instance from the asset.</summary>
        public void Initialize()
        {
            Release();
            loadedAsset = skeletonAsset;
            if (skeletonAsset == null) return;
            RabbitSkeletonData data;
            try { data = skeletonAsset.GetData(); }
            catch (Exception e)
            {
                Debug.LogError(e.Message, this);
                return;
            }
            if (data == null) return;
            Instance = data.CreateInstance();
            Instance.SetDefaultMix(skeletonAsset.defaultMix);
            mesh = new Mesh { name = "RABBIT " + skeletonAsset.name };
            mesh.MarkDynamic();
            GetComponent<MeshFilter>().sharedMesh = mesh;
            playing = null;
            appliedSkin = null;
            Sync();
            Instance.Update(0);
            Draw();
        }

        void Release()
        {
            Instance?.Dispose();
            Instance = null;
            if (mesh != null)
            {
                if (Application.isPlaying) Destroy(mesh); else DestroyImmediate(mesh);
                mesh = null;
            }
            foreach (var m in materials.Values)
                if (m != null) { if (Application.isPlaying) Destroy(m); else DestroyImmediate(m); }
            materials.Clear();
        }

        /// <summary>Plays an animation on track 0 (crossfading).</summary>
        public void Play(string name, bool loop = true)
        {
            animationName = name;
            this.loop = loop;
            Sync();
        }

        /// <summary>Queues an animation after the current one on a track.</summary>
        public void Queue(string name, bool loop = true, float delay = 0, int track = 0) => Instance?.AddAnimation(track, name, loop, delay);

        void Sync()
        {
            if (Instance == null) return;
            if (skin != appliedSkin)
            {
                if (!string.IsNullOrEmpty(skin) && !Instance.SetSkin(skin)) Debug.LogWarning($"RABBIT: skin not found: {skin}", this);
                appliedSkin = skin;
            }
            if (animationName != playing || loop != playingLoop)
            {
                if (!string.IsNullOrEmpty(animationName) && Array.IndexOf(Instance.Data.Animations, animationName) >= 0)
                    Instance.SetAnimation(0, animationName, loop);
                else if (string.IsNullOrEmpty(animationName))
                    Instance.SetEmptyAnimation(0, 0);
                playing = animationName;
                playingLoop = loop;
            }
        }

        void Update()
        {
            if (Instance == null) return;
            Sync();
            double dt;
            if (Application.isPlaying) dt = Time.deltaTime;
            else
            {
#if UNITY_EDITOR
                double now = UnityEditor.EditorApplication.timeSinceStartup;
                dt = lastEditorTime > 0 && previewInEditor ? Math.Min(now - lastEditorTime, 0.1) : 0;
                lastEditorTime = now;
#else
                dt = 0;
#endif
            }
            Instance.SetColor(color.r, color.g, color.b, color.a);
            Instance.Update(dt * timeScale);
            Instance.PollEvents(events);
            if (events.Count > 0)
            {
                foreach (var e in events) AnimationEvent?.Invoke(this, e);
                events.Clear();
            }
        }

        void LateUpdate()
        {
            if (Instance != null) Draw();
#if UNITY_EDITOR
            if (!Application.isPlaying && previewInEditor) UnityEditor.EditorApplication.QueuePlayerLoopUpdate();
#endif
        }

        void Draw()
        {
            Instance.Render(render);
            float s = skeletonAsset.scale;
            int n = render.VertexCount;
            positions.Clear();
            uvs.Clear();
            lights.Clear();
            darks.Clear();
            for (int v = 0; v < n; v++)
            {
                positions.Add(new Vector3(render.X(v) * s, render.Y(v) * s, 0));
                uvs.Add(new Vector2(render.U(v), 1 - render.V(v)));
                uint l = render.Light(v), d = render.Dark(v);
                lights.Add(new Color32((byte)l, (byte)(l >> 8), (byte)(l >> 16), (byte)(l >> 24)));
                darks.Add(new Vector3((byte)d / 255f, (byte)(d >> 8) / 255f, (byte)(d >> 16) / 255f));
            }
            mesh.Clear();
            mesh.indexFormat = n > 65535 ? UnityEngine.Rendering.IndexFormat.UInt32 : UnityEngine.Rendering.IndexFormat.UInt16;
            mesh.SetVertices(positions);
            mesh.SetUVs(0, uvs);
            mesh.SetUVs(1, darks);
            mesh.SetColors(lights);
            mesh.subMeshCount = render.Batches.Count;
            frameMaterials.Clear();
            for (int b = 0; b < render.Batches.Count; b++)
            {
                var batch = render.Batches[b];
                tris.Clear();
                for (uint i = 0; i < batch.IndexCount; i++) tris.Add((int)render.Indices[batch.FirstIndex + i]);
                mesh.SetTriangles(tris, b, false);
                frameMaterials.Add(MaterialFor((int)batch.Page, (int)batch.Blend));
            }
            mesh.RecalculateBounds();
            var r = GetComponent<MeshRenderer>();
            if (!SameMaterials(r)) r.sharedMaterials = frameMaterials.ToArray();
        }

        bool SameMaterials(MeshRenderer r)
        {
            var cur = r.sharedMaterials;
            if (cur.Length != frameMaterials.Count) return false;
            for (int i = 0; i < cur.Length; i++)
                if (cur[i] != frameMaterials[i]) return false;
            return true;
        }

        Material MaterialFor(int page, int blend)
        {
            var tex = skeletonAsset.PageTexture(page);
            bool pma = skeletonAsset.PagePremultiplied(page);
            if (materials.TryGetValue((tex, blend, pma), out var m) && m != null) return m;
            var sh = shader != null ? shader : Shader.Find("RABBIT/Skeleton");
            m = new Material(sh) { name = $"RABBIT page {page} blend {blend}", hideFlags = HideFlags.DontSave };
            m.mainTexture = tex;
            m.SetFloat("_StraightAlpha", pma ? 0 : 1);
            // Premultiplied blending: normal, additive, multiply, screen.
            var (src, dst) = (RabbitBlend)blend switch
            {
                RabbitBlend.Additive => (UnityEngine.Rendering.BlendMode.One, UnityEngine.Rendering.BlendMode.One),
                RabbitBlend.Multiply => (UnityEngine.Rendering.BlendMode.DstColor, UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha),
                RabbitBlend.Screen => (UnityEngine.Rendering.BlendMode.One, UnityEngine.Rendering.BlendMode.OneMinusSrcColor),
                _ => (UnityEngine.Rendering.BlendMode.One, UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha),
            };
            m.SetFloat("_SrcBlend", (float)src);
            m.SetFloat("_DstBlend", (float)dst);
            materials[(tex, blend, pma)] = m;
            return m;
        }

        /// <summary>World position of a bone (null if the bone doesn't exist or is inactive).</summary>
        public Vector3? BonePosition(string bone)
        {
            if (Instance == null) return null;
            int i = Instance.Data.FindBone(bone);
            if (i < 0 || !Instance.BoneWorld(i, out _, out _, out _, out _, out float x, out float y)) return null;
            return transform.TransformPoint(new Vector3(x * skeletonAsset.scale, y * skeletonAsset.scale, 0));
        }

        /// <summary>World rotation (degrees around Z) of a bone's X axis.</summary>
        public float BoneRotation(string bone)
        {
            if (Instance == null) return 0;
            int i = Instance.Data.FindBone(bone);
            if (i < 0) return 0;
            Instance.BoneWorld(i, out float a, out _, out float c, out _, out _, out _);
            return Mathf.Atan2(c, a) * Mathf.Rad2Deg + transform.eulerAngles.z;
        }
    }
}
