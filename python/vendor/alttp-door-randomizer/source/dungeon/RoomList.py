from RoomData import DoorKind, Position
from source.dungeon.RoomObject import RoomObject, DoorObject


class Room:

    def __init__(self, layout, layer1, layer2, doors):
        self.layout = layout
        self.layer1 = layer1
        self.layer2 = layer2
        self.doors = doors

    def write_to_rom(self, address, rom):
        rom.write_bytes(address, self.layout)
        address += 2
        for obj in self.layer1:
            rom.write_bytes(address, obj.data)
            address += 3
        rom.write_bytes(address, [0xFF, 0xFF])
        address += 2
        for obj in self.layer2:
            rom.write_bytes(address, obj.data)
            address += 3
        rom.write_bytes(address, [0xFF, 0xFF, 0xF0, 0xFF])
        address += 4
        for door in self.doors:
            rom.write_bytes(address, door.get_bytes())
            address += 2
        rom.write_bytes(address, [0xFF, 0xFF])
        return address + 2  # where the data ended


Room0127 = Room([0xE1, 0x00],
                [RoomObject(0x0AB600, [0xFE, 0x89, 0x00]),
                 RoomObject(0x0AB603, [0xA2, 0xA1, 0x61]),
                 RoomObject(0x0AB606, [0xFE, 0x8E, 0x81]),
                 RoomObject(0x0AB609, [0xFF, 0x49, 0x02]),
                 RoomObject(0x0AB60C, [0xD2, 0xA1, 0x62]),
                 RoomObject(0x0AB60F, [0xFF, 0x4E, 0x83]),
                 RoomObject(0x0AB612, [0x20, 0xB3, 0xDD]),
                 RoomObject(0x0AB615, [0x50, 0xB3, 0xDD]),
                 RoomObject(0x0AB618, [0x33, 0xCB, 0xFA]),
                 RoomObject(0x0AB61B, [0x3B, 0xCB, 0xFA]),
                 RoomObject(0x0AB61E, [0x43, 0xCB, 0xFA]),
                 RoomObject(0x0AB621, [0x4B, 0xCB, 0xFA]),
                 RoomObject(0x0AB624, [0xBF, 0x94, 0xF9]),
                 RoomObject(0x0AB627, [0xB3, 0xB3, 0xFA]),
                 RoomObject(0x0AB62A, [0xCB, 0xB3, 0xFA]),
                 RoomObject(0x0AB62D, [0xAD, 0xC8, 0xDF]),
                 RoomObject(0x0AB630, [0xC4, 0xC8, 0xDF]),
                 RoomObject(0x0AB633, [0xB3, 0xE3, 0xFA]),
                 RoomObject(0x0AB636, [0xCB, 0xE3, 0xFA]),
                 RoomObject(0x0AB639, [0x81, 0x93, 0xC0]),
                 RoomObject(0x0AB63C, [0x81, 0xD2, 0xC0]),
                 RoomObject(0x0AB63F, [0xE1, 0x93, 0xC0]),
                 RoomObject(0x0AB642, [0xE1, 0xD2, 0xC0])],
                [], [DoorObject(Position.SouthW, DoorKind.CaveEntrance),
                     DoorObject(Position.SouthE, DoorKind.CaveEntrance)])
