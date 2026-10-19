# SmartPark Vision service (planned)

The computer-vision service will be implemented here in a later phase. The first version should support a sample video, manually configured slot polygons, stabilized occupied/empty/unknown classifications, camera health and authenticated occupancy events to the API.

Do not mark a space available solely because a camera detector reports it as empty. The booking engine must also consider overlapping reservations, current sessions and the slot/facility operational state.
