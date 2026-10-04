import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 className 并处理 Tailwind 冲突类，供共享组件使用。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
