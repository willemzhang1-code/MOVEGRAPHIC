extends SceneTree
## Headless smoke test: godot --headless --path godot/example --script res://test.gd

func fail(msg: String) -> void:
	print("RABBIT_TEST FAIL ", msg)
	quit(1)

func _initialize() -> void:
	if not ClassDB.class_exists("RabbitSkeleton2D"):
		fail("extension not loaded")
		return
	var sk = ClassDB.instantiate("RabbitSkeleton2D")
	sk.skeleton_file = "res://character/layered.json"
	sk.atlas_file = "res://character/layered.atlas"
	sk.animation = "walk"
	root.add_child(sk)
	await process_frame
	var names: PackedStringArray = sk.get_animation_names()
	if not names.has("walk") or not names.has("jump"):
		fail("animations missing: %s" % names)
		return
	var a0: Vector2 = sk.get_bone_position("shin_l")
	for i in 20:
		await process_frame
	var a1: Vector2 = sk.get_bone_position("shin_l")
	if a0.distance_to(a1) < 1.0:
		fail("walk did not move the leg (%s -> %s)" % [a0, a1])
		return
	if not sk.play(0, "jump", false):
		fail("play(jump) returned false")
		return
	sk.add_animation(0, "idle", true, 0.0)
	var hip0: Vector2 = sk.get_bone_position("hip")
	var highest := hip0.y
	for i in 120:
		await process_frame
		highest = min(highest, sk.get_bone_position("hip").y)
	if hip0.y - highest < 20.0:
		fail("jump did not lift the hip (%s, min y %s)" % [hip0.y, highest])
		return
	if sk.get_current_animation(0) != "idle":
		fail("queued idle not playing: %s" % sk.get_current_animation(0))
		return
	print("RABBIT_TEST PASS animations=%s jump=%.1f" % [names.size(), hip0.y - highest])
	quit(0)
