"""Read-only standalone example; short-lived token is read without echo."""

import asyncio
import getpass
import os

from travel_client import TravelClient


async def main() -> None:
    token = getpass.getpass("Travel API access token: ")

    async def get_token() -> str:
        return token

    async with TravelClient(os.environ["TRAVEL_ORIGIN"], get_token) as client:
        trips = await client.trips()
        for index, trip in enumerate(trips):
            print(index, trip.title)
        selected = await client.select_trip(trips[int(input("Trip number: "))].id)
        for task in await selected.tasks():
            print(task.id, task.title, task.completed_at is not None)


if __name__ == "__main__":
    asyncio.run(main())
