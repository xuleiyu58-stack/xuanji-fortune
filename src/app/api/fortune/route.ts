import { NextRequest, NextResponse } from "next/server";
import { getFortune } from "@/lib/ai";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mode, ...userInput } = body;

    if (!mode) {
      return NextResponse.json(
        { success: false, error: "请选择测算模式" },
        { status: 400 }
      );
    }

    const result = await getFortune(mode, userInput);

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { success: false, error: "天机不可泄露，请稍后再试" },
      { status: 500 }
    );
  }
}
