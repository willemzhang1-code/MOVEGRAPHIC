using UnityEngine;

namespace Rabbit
{
    /// <summary>Keeps this transform on a skeleton bone (e.g. a weapon in a hand, a particle at a foot).</summary>
    [ExecuteAlways]
    [AddComponentMenu("RABBIT/Bone Follower")]
    public sealed class RabbitBoneFollower : MonoBehaviour
    {
        public RabbitSkeleton skeleton;
        public string bone;
        public bool followRotation = true;

        void LateUpdate()
        {
            if (skeleton == null || string.IsNullOrEmpty(bone)) return;
            var p = skeleton.BonePosition(bone);
            if (p == null) return;
            transform.position = p.Value;
            if (followRotation) transform.rotation = Quaternion.Euler(0, 0, skeleton.BoneRotation(bone));
        }
    }
}
