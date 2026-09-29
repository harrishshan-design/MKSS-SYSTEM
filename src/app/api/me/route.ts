import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
export async function GET(req: NextRequest) { try { return NextResponse.json(await actor(req)); } catch (error) { return fail(error); } }
