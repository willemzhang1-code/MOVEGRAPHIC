using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Rabbit.Editor
{
    /// <summary>
    /// When a skeleton .json arrives next to a same-named .atlas (an export from the
    /// RABBIT Studio or Spine), creates a RabbitSkeletonAsset wired to the json,
    /// atlas and page textures.
    /// </summary>
    sealed class RabbitAssetPostprocessor : AssetPostprocessor
    {
        static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] movedFrom)
        {
            foreach (var path in imported)
            {
                if (!path.EndsWith(".json") || path.EndsWith(".rabbit.json")) continue;
                string dir = Path.GetDirectoryName(path);
                string baseName = Path.GetFileNameWithoutExtension(path);
                string atlasPath = Path.Combine(dir, baseName + ".atlas").Replace('\\', '/');
                if (!File.Exists(atlasPath))
                {
                    var any = Directory.GetFiles(dir, "*.atlas");
                    if (any.Length != 1) continue;
                    atlasPath = any[0].Replace('\\', '/');
                }
                string assetPath = Path.Combine(dir, baseName + "_Skeleton.asset").Replace('\\', '/');
                if (AssetDatabase.LoadAssetAtPath<RabbitSkeletonAsset>(assetPath) != null) continue;
                var json = AssetDatabase.LoadAssetAtPath<TextAsset>(path);
                var atlas = AssetDatabase.LoadAssetAtPath<TextAsset>(atlasPath);
                if (json == null || atlas == null || !json.text.Contains("\"bones\"")) continue;

                var asset = ScriptableObject.CreateInstance<RabbitSkeletonAsset>();
                asset.skeletonJson = json;
                asset.atlas = atlas;
                asset.pages = PageNames(atlas.text)
                    .Select(p => AssetDatabase.LoadAssetAtPath<Texture2D>(Path.Combine(dir, p).Replace('\\', '/')))
                    .Where(t => t != null)
                    .ToArray();
                AssetDatabase.CreateAsset(asset, assetPath);
                Debug.Log($"RABBIT: created {assetPath}");
            }
        }

        /// <summary>Page image names: lines ending in an image extension that aren't indented.</summary>
        static IEnumerable<string> PageNames(string atlas)
        {
            foreach (var raw in atlas.Split('\n'))
            {
                var line = raw.TrimEnd('\r');
                if (line.Length == 0 || char.IsWhiteSpace(line[0])) continue;
                var l = line.ToLowerInvariant();
                if (l.EndsWith(".png") || l.EndsWith(".jpg") || l.EndsWith(".jpeg") || l.EndsWith(".webp")) yield return line.Trim();
            }
        }

        [MenuItem("GameObject/RABBIT/Skeleton", false, 10)]
        static void CreateSkeleton(MenuCommand cmd)
        {
            var go = new GameObject("Skeleton", typeof(MeshFilter), typeof(MeshRenderer), typeof(RabbitSkeleton));
            var asset = Selection.activeObject as RabbitSkeletonAsset;
            var sk = go.GetComponent<RabbitSkeleton>();
            if (asset != null)
            {
                sk.skeletonAsset = asset;
                var data = asset.GetData();
                if (data != null && data.Animations.Length > 0) sk.animationName = data.Animations[0];
                go.name = asset.name.Replace("_Skeleton", "");
            }
            GameObjectUtility.SetParentAndAlign(go, cmd.context as GameObject);
            Undo.RegisterCreatedObjectUndo(go, "Create RABBIT skeleton");
            Selection.activeObject = go;
        }
    }
}
