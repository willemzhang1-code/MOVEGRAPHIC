// Minimal UnityEditor surface used by the package's editor scripts, for a
// compile check without a Unity install. Signatures follow the public docs.
using System;
namespace UnityEditor
{
    public class AssetPostprocessor { }
    [AttributeUsage(AttributeTargets.Method)] public sealed class MenuItem : Attribute { public MenuItem(string path, bool validate, int priority) { } public MenuItem(string path) { } }
    public sealed class MenuCommand { public UnityEngine.Object context; }
    public static class AssetDatabase
    {
        public static T LoadAssetAtPath<T>(string path) where T : UnityEngine.Object => null;
        public static void CreateAsset(UnityEngine.Object asset, string path) { }
    }
    public static class Selection { public static UnityEngine.Object activeObject; }
    public static class GameObjectUtility { public static void SetParentAndAlign(UnityEngine.GameObject child, UnityEngine.GameObject parent) { } }
    public static class Undo { public static void RegisterCreatedObjectUndo(UnityEngine.Object o, string name) { } }
    public static class EditorApplication { public static double timeSinceStartup; public static void QueuePlayerLoopUpdate() { } }
}
namespace UnityEditor.AssetImporters
{
    [AttributeUsage(AttributeTargets.Class)] public sealed class ScriptedImporterAttribute : Attribute { public ScriptedImporterAttribute(int version, string ext) { } }
    public abstract class ScriptedImporter { public abstract void OnImportAsset(AssetImportContext ctx); }
    public sealed class AssetImportContext
    {
        public string assetPath;
        public void AddObjectToAsset(string id, UnityEngine.Object o) { }
        public void SetMainObject(UnityEngine.Object o) { }
    }
}
