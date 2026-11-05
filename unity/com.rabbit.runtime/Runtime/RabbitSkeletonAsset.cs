using UnityEngine;

namespace Rabbit
{
    /// <summary>
    /// A skeleton export: RABBIT / Spine 4.2 JSON, its libGDX atlas and page textures.
    /// Created automatically when a .json with a sibling .atlas is imported.
    /// </summary>
    [CreateAssetMenu(menuName = "RABBIT/Skeleton Asset", fileName = "Skeleton")]
    public sealed class RabbitSkeletonAsset : ScriptableObject
    {
        public TextAsset skeletonJson;
        public TextAsset atlas;
        [Tooltip("Atlas page textures. Matched to atlas pages by file name, else by order.")]
        public Texture2D[] pages = new Texture2D[0];
        [Tooltip("Unity units per skeleton unit (0.01 = 100 skeleton pixels per unit).")]
        public float scale = 0.01f;
        [Tooltip("Default crossfade between animations, seconds.")]
        public float defaultMix = 0.2f;

        RabbitSkeletonData data;

        /// <summary>Parsed data, shared by every component using this asset.</summary>
        public RabbitSkeletonData GetData()
        {
            if (data == null && skeletonJson != null)
            {
                data = RabbitSkeletonData.Load(skeletonJson.text, atlas != null ? atlas.text : "");
                foreach (var w in data.Warnings) Debug.LogWarning($"RABBIT {name}: {w}", this);
            }
            return data;
        }

        public Texture2D PageTexture(int page)
        {
            var d = GetData();
            if (d != null && page < d.Pages.Length)
            {
                string want = System.IO.Path.GetFileNameWithoutExtension(d.Pages[page]);
                foreach (var t in pages)
                    if (t != null && t.name == want) return t;
            }
            return page < pages.Length ? pages[page] : null;
        }

        public bool PagePremultiplied(int page)
        {
            var d = GetData();
            return d != null && page < d.PagePremultiplied.Length && d.PagePremultiplied[page];
        }

        /// <summary>Drops the parsed data (re-read on next use).</summary>
        public void Clear()
        {
            data?.Dispose();
            data = null;
        }

        void OnValidate() => Clear();
        void OnDisable() => Clear();
    }
}
