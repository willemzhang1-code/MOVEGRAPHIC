using System.IO;
#if UNITY_2020_2_OR_NEWER
using UnityEditor.AssetImporters;
#else
using UnityEditor.Experimental.AssetImporters;
#endif
using UnityEngine;

namespace Rabbit.Editor
{
    /// <summary>Imports libGDX .atlas files as TextAssets.</summary>
    [ScriptedImporter(1, "atlas")]
    public sealed class RabbitAtlasImporter : ScriptedImporter
    {
        public override void OnImportAsset(AssetImportContext ctx)
        {
            var text = new TextAsset(File.ReadAllText(ctx.assetPath));
            ctx.AddObjectToAsset("atlas", text);
            ctx.SetMainObject(text);
        }
    }
}
