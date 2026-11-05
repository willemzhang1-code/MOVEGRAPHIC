extends Node2D
## Keys: 1 idle · 2 walk · 3 run · space jump · H hit · A attack

@onready var character := $Character

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		match event.keycode:
			KEY_1: character.play(0, "idle", true)
			KEY_2: character.play(0, "walk", true)
			KEY_3: character.play(0, "run", true)
			KEY_SPACE:
				character.play(0, "jump", false)
				character.add_animation(0, "idle", true, 0.0)
			KEY_H:
				character.play(1, "hit", false)
				character.set_empty_animation(1, 0.2)
			KEY_A:
				character.play(0, "attack", false)
				character.add_animation(0, "idle", true, 0.0)
