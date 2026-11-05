using Rabbit;
using UnityEngine;

/// <summary>
/// Sample: click (or press Space) to cycle the skeleton's animations; logs
/// animation events. Add next to a RabbitSkeleton component.
/// </summary>
[RequireComponent(typeof(RabbitSkeleton))]
public sealed class RabbitDemo : MonoBehaviour
{
    RabbitSkeleton skeleton;
    int index;

    void Start()
    {
        skeleton = GetComponent<RabbitSkeleton>();
        skeleton.AnimationEvent += (s, e) =>
        {
            if (e.Kind == RabbitEventKind.Event) Debug.Log($"event {e.Name} int={e.Int} float={e.Float}");
        };
    }

    void Update()
    {
        if (skeleton.Data == null) return;
        if (Input.GetMouseButtonDown(0) || Input.GetKeyDown(KeyCode.Space))
        {
            var names = skeleton.Data.Animations;
            index = (index + 1) % names.Length;
            skeleton.Play(names[index]);
        }
    }
}
