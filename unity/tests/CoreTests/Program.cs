using System;
using System.Collections.Generic;
using System.IO;
using Rabbit;

static class Program
{
    static int failures;

    static void Check(bool ok, string what)
    {
        Console.WriteLine((ok ? "  ok   " : "  FAIL ") + what);
        if (!ok) failures++;
    }

    static int Main(string[] args)
    {
        string root = args.Length > 0 ? args[0] : "../../..";
        Console.WriteLine("native version " + RabbitNative_Version());

        // 1. Layered PSD character exported by the Studio (Godot example copy).
        var dir = Path.Combine(root, "godot/example/character");
        using (var data = RabbitSkeletonData.Load(File.ReadAllText(Path.Combine(dir, "layered.json")), File.ReadAllText(Path.Combine(dir, "layered.atlas"))))
        {
            Check(data.Bones.Length > 10, $"bones {data.Bones.Length}");
            Check(Array.IndexOf(data.Animations, "walk") >= 0, $"animations {string.Join(",", data.Animations)}");
            Check(data.Pages.Length == 1 && data.Pages[0] == "layered.png", "atlas page");
            Check(data.Warnings.Length == 0, $"warnings {data.Warnings.Length}");
            using var inst = data.CreateInstance();
            int id = inst.SetAnimation(0, "walk", true);
            inst.AddAnimation(0, "jump", false, 0);
            Check(id > 0, "set animation");
            var rd = new RabbitRenderData();
            var events = new List<RabbitEvent>();
            float minY = float.MaxValue, maxY = float.MinValue;
            for (int f = 0; f < 240; f++)
            {
                inst.Update(1.0 / 60.0);
                inst.Render(rd);
                inst.PollEvents(events);
                for (int v = 0; v < rd.VertexCount; v++)
                {
                    minY = Math.Min(minY, rd.Y(v));
                    maxY = Math.Max(maxY, rd.Y(v));
                }
            }
            Check(rd.VertexCount > 100 && rd.IndexCount % 3 == 0, $"render {rd.VertexCount} verts, {rd.IndexCount / 3} tris, {rd.Batches.Count} batches");
            Check(maxY - minY > 50, $"geometry moves (y {minY:F1}..{maxY:F1})");
            Check(events.Exists(e => e.Kind == RabbitEventKind.Start) && events.Exists(e => e.Kind == RabbitEventKind.Complete), $"events {events.Count}");
            int head = data.FindBone("head");
            Check(inst.BoneWorld(head, out _, out _, out _, out _, out float hx, out float hy) && hy > 0, $"head bone at ({hx:F1}, {hy:F1})");
            bool threw = false;
            try { inst.SetAnimation(0, "nope", true); } catch (ArgumentException) { threw = true; }
            Check(threw, "unknown animation throws");
        }

        // 2. Bad input surfaces the native error.
        try
        {
            RabbitSkeletonData.Load("{not json", "");
            Check(false, "bad json throws");
        }
        catch (FormatException e) { Check(e.Message.Length > 10, "bad json: " + e.Message); }

        // 3. Every Spine example present locally (not redistributed): load, play all animations.
        var ex = Path.Combine(root, "web/public/examples/4.2");
        if (File.Exists(Path.Combine(ex, "index.json")))
        {
            int loaded = 0, verts = 0;
            foreach (var d in Directory.GetDirectories(ex))
            {
                var json = Directory.GetFiles(d, "*.json");
                var atlas = Directory.GetFiles(d, "*.atlas");
                if (json.Length == 0 || atlas.Length == 0) continue;
                using var data = RabbitSkeletonData.Load(File.ReadAllText(json[0]), File.ReadAllText(atlas[0]));
                using var inst = data.CreateInstance();
                if (data.Skins.Length > 1) inst.SetSkin(data.Skins[1]);
                var rd = new RabbitRenderData();
                foreach (var a in data.Animations)
                {
                    inst.SetAnimation(0, a, true);
                    for (int f = 0; f < 30; f++) inst.Update(1.0 / 30.0);
                    inst.Render(rd);
                    verts += rd.VertexCount;
                    for (int v = 0; v < rd.VertexCount; v++)
                        if (float.IsNaN(rd.X(v)) || float.IsNaN(rd.Y(v))) { Check(false, $"NaN in {Path.GetFileName(d)}/{a}"); break; }
                }
                loaded++;
            }
            Check(loaded == 20, $"spine examples loaded {loaded}, {verts} vertices total");
        }
        Console.WriteLine(failures == 0 ? "CORE_TESTS PASS" : $"CORE_TESTS FAIL {failures}");
        return failures == 0 ? 0 : 1;
    }

    static unsafe string RabbitNative_Version()
    {
        uint v = NativeVersion();
        return $"{v >> 16}.{(v >> 8) & 0xff}.{v & 0xff}";
    }

    [System.Runtime.InteropServices.DllImport("sinew_ffi", EntryPoint = "sinew_version")]
    static extern uint NativeVersion();
}
