import { describe, expect, it } from "vitest";
import { VirtualInputState } from "../src/input/VirtualInputState";

describe("mobile virtual controls", () => {
  it("prioritizes horizontal input and consumes actions exactly once", () => {
    const input = new VirtualInputState();
    input.setDirection("right", true);
    input.setDirection("up", true);
    expect(input.movement()).toEqual({ x: 1, y: 0 });
    input.queueAction();
    expect(input.consumeAction()).toBe(true);
    expect(input.consumeAction()).toBe(false);
    input.queueParty();
    expect(input.consumeParty()).toBe(true);
    expect(input.consumeParty()).toBe(false);
    input.reset();
    expect(input.movement()).toEqual({ x: 0, y: 0 });
  });
});
