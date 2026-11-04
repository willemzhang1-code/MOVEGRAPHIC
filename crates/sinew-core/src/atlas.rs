//! Texture atlas in the libGDX / Spine text format (both the `bounds:` /
//! `offsets:` style and the older `xy:` / `size:` / `orig:` style).

use std::collections::HashMap;

use crate::model::TextureRegion;

#[derive(Clone, Debug)]
pub struct AtlasPage {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub pma: bool,
    pub min_filter: String,
    pub mag_filter: String,
    pub repeat: String,
}

#[derive(Clone, Debug, Default)]
pub struct Atlas {
    pub pages: Vec<AtlasPage>,
    pub regions: Vec<(String, TextureRegion)>,
    index: HashMap<String, usize>,
}

impl Atlas {
    pub fn find(&self, name: &str) -> Option<&TextureRegion> {
        self.index.get(name).map(|&i| &self.regions[i].1)
    }

    pub fn add_page(&mut self, page: AtlasPage) -> u32 {
        self.pages.push(page);
        (self.pages.len() - 1) as u32
    }

    pub fn add_region(&mut self, name: impl Into<String>, region: TextureRegion) {
        let name = name.into();
        // First region with a given name wins (sequence frames use `index`).
        self.index.entry(name.clone()).or_insert(self.regions.len());
        self.regions.push((name, region));
    }

    pub fn parse(text: &str) -> Result<Atlas, String> {
        let mut atlas = Atlas::default();
        let mut page: Option<u32> = None;
        let mut region: Option<(String, RegionProps)> = None;
        let mut expect_page = true;

        let flush = |atlas: &mut Atlas, region: &mut Option<(String, RegionProps)>, page: Option<u32>| -> Result<(), String> {
            if let Some((name, p)) = region.take() {
                let pi = page.ok_or("region before page")?;
                let pg = &atlas.pages[pi as usize];
                let (w, h) = p.size.ok_or_else(|| format!("region '{name}' has no size"))?;
                let (ow, oh) = p.orig.unwrap_or((w, h));
                let (ox, oy) = p.offset.unwrap_or((0.0, 0.0));
                let (x, y) = p.xy.unwrap_or((0.0, 0.0));
                let r = TextureRegion {
                    page: pi,
                    page_width: pg.width.max(1) as f32,
                    page_height: pg.height.max(1) as f32,
                    x,
                    y,
                    width: w,
                    height: h,
                    offset_x: ox,
                    offset_y: oy,
                    original_width: ow,
                    original_height: oh,
                    degrees: p.degrees,
                };
                atlas.add_region(name, r);
            }
            Ok(())
        };

        for raw in text.lines() {
            let line = raw.trim_end();
            if line.trim().is_empty() {
                flush(&mut atlas, &mut region, page)?;
                expect_page = true;
                continue;
            }
            let trimmed = line.trim();
            let kv = trimmed.split_once(':').map(|(k, v)| (k.trim(), v.trim()));
            if expect_page {
                // First non-empty line of a block is the page name.
                flush(&mut atlas, &mut region, page)?;
                page = Some(atlas.add_page(AtlasPage {
                    name: trimmed.to_string(),
                    width: 0,
                    height: 0,
                    pma: false,
                    min_filter: "Linear".into(),
                    mag_filter: "Linear".into(),
                    repeat: "none".into(),
                }));
                expect_page = false;
                continue;
            }
            match (kv, &mut region) {
                (Some((k, v)), None) => {
                    let pg = atlas.pages.last_mut().unwrap();
                    match k {
                        "size" => {
                            let n = nums(v);
                            if n.len() >= 2 {
                                pg.width = n[0] as u32;
                                pg.height = n[1] as u32;
                            }
                        }
                        "filter" => {
                            let mut it = v.split(',').map(|s| s.trim().to_string());
                            pg.min_filter = it.next().unwrap_or_default();
                            pg.mag_filter = it.next().unwrap_or_else(|| pg.min_filter.clone());
                        }
                        "repeat" => pg.repeat = v.to_string(),
                        "pma" => pg.pma = v == "true",
                        _ => {}
                    }
                }
                (Some((k, v)), Some((_, p))) => {
                    let n = nums(v);
                    match k {
                        "bounds" if n.len() >= 4 => {
                            p.xy = Some((n[0], n[1]));
                            p.size = Some((n[2], n[3]));
                        }
                        "offsets" if n.len() >= 4 => {
                            p.offset = Some((n[0], n[1]));
                            p.orig = Some((n[2], n[3]));
                        }
                        "xy" if n.len() >= 2 => p.xy = Some((n[0], n[1])),
                        "size" if n.len() >= 2 => p.size = Some((n[0], n[1])),
                        "orig" if n.len() >= 2 => p.orig = Some((n[0], n[1])),
                        "offset" if n.len() >= 2 => p.offset = Some((n[0], n[1])),
                        "rotate" => {
                            p.degrees = match v {
                                "true" => 90,
                                "false" => 0,
                                other => other.parse::<i32>().unwrap_or(0),
                            }
                        }
                        _ => {}
                    }
                }
                (None, _) => {
                    flush(&mut atlas, &mut region, page)?;
                    region = Some((trimmed.to_string(), RegionProps::default()));
                }
            }
        }
        flush(&mut atlas, &mut region, page)?;
        Ok(atlas)
    }
}

#[derive(Default)]
struct RegionProps {
    xy: Option<(f32, f32)>,
    size: Option<(f32, f32)>,
    orig: Option<(f32, f32)>,
    offset: Option<(f32, f32)>,
    degrees: i32,
}

fn nums(v: &str) -> Vec<f32> {
    v.split(',').filter_map(|s| s.trim().parse::<f32>().ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEW: &str = "\nhero.png\nsize: 256, 128\nfilter: Linear, Linear\npma: true\nhead\n  bounds: 2, 2, 60, 40\n  offsets: 1, 2, 64, 44\narm\n  bounds: 70, 2, 20, 50\n  rotate: 90\n\nhero2.png\nsize: 64, 64\nleg\n  bounds: 0, 0, 10, 10\n";
    const OLD: &str = "hero.png\nsize: 256,128\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nhead\n  rotate: false\n  xy: 2, 2\n  size: 60, 40\n  orig: 64, 44\n  offset: 1, 2\n  index: -1\n";

    #[test]
    fn parses_new_format() {
        let a = Atlas::parse(NEW).unwrap();
        assert_eq!(a.pages.len(), 2);
        assert!(a.pages[0].pma);
        assert_eq!((a.pages[0].width, a.pages[0].height), (256, 128));
        let head = a.find("head").unwrap();
        assert_eq!((head.x, head.y, head.width, head.height), (2.0, 2.0, 60.0, 40.0));
        assert_eq!((head.offset_x, head.offset_y, head.original_width, head.original_height), (1.0, 2.0, 64.0, 44.0));
        assert_eq!(a.find("arm").unwrap().degrees, 90);
        assert_eq!(a.find("leg").unwrap().page, 1);
    }

    #[test]
    fn parses_old_format() {
        let a = Atlas::parse(OLD).unwrap();
        let head = a.find("head").unwrap();
        assert_eq!((head.x, head.width, head.original_width, head.offset_y), (2.0, 60.0, 64.0, 2.0));
    }

    #[test]
    fn uv_mapping_unrotated_and_rotated() {
        let a = Atlas::parse(NEW).unwrap();
        let head = a.find("head").unwrap();
        // Bottom-left of trimmed area in original UV space maps to page (x, y+h).
        let (u, v) = head.map_uv(1.0 / 64.0, (44.0 - 2.0) / 44.0);
        assert!((u - 2.0 / 256.0).abs() < 1e-5 && (v - 42.0 / 128.0).abs() < 1e-5);
        let arm = a.find("arm").unwrap();
        // Rotated 90: footprint is height x width in the page.
        let (u0, v0) = arm.map_uv(0.0, 0.0);
        let (u1, v1) = arm.map_uv(1.0, 1.0);
        assert!((u0 - 70.0 / 256.0).abs() < 1e-5 && (v0 - 22.0 / 128.0).abs() < 1e-5);
        assert!((u1 - 120.0 / 256.0).abs() < 1e-5 && (v1 - 2.0 / 128.0).abs() < 1e-5);
    }
}
