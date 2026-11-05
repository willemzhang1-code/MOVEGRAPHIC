extends SceneTree
## Renders a few frames of the example scene and saves screenshots (needs a display).

func _initialize() -> void:
	var scene = load("res://main.tscn").instantiate()
	root.add_child(scene)
	var c = scene.get_node("Character")
	c.play(0, "run", true)
	for i in 40:
		await process_frame
		if i % 10 == 0:
			print("FRAME ", i, " anim=", c.get_current_animation(0), " shin=", c.get_bone_position("shin_l"), " verts=", c.get_rendered_vertex_count(), " proc=", c.is_processing())
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png("user://run1.png")
	for i in 9:
		await process_frame
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png("user://run2.png")
	print("SHOT ", OS.get_user_data_dir())
	quit(0)
