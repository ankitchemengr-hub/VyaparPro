import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onFocus, onWheel, ...props }, ref) => {
    const isNumber = type === "number"
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        onFocus={(e) => {
          // Number fields: select the current contents so the first keypress
          // replaces the value instead of appending to a leftover "0" that
          // otherwise can only be cleared with arrow keys + backspace.
          if (isNumber) e.currentTarget.select()
          onFocus?.(e)
        }}
        onWheel={(e) => {
          // Stop the mouse wheel from silently changing a focused number field
          // while the user is only trying to scroll the page.
          if (isNumber && document.activeElement === e.currentTarget) {
            e.currentTarget.blur()
          }
          onWheel?.(e)
        }}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
