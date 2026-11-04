//! Sinew core: 2D skeletal animation evaluation shared by the editor and
//! every runtime.

pub mod animation;
pub mod atlas;
pub mod constraints;
pub mod curve;
pub mod import;
pub mod math;
pub mod model;
pub mod render;
pub mod skeleton;
pub mod state;

pub use animation::{Animation, MixBlend};
pub use atlas::Atlas;
pub use math::{Affine, Color, Transform, Vec2};
pub use model::SkeletonData;
pub use render::{RenderBatch, RenderBuffers, VERTEX_WORDS};
pub use skeleton::Skeleton;
pub use state::{AnimationState, StateEvent, StateEventKind, TrackEntry};
