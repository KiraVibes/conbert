# Builds player.gba – the GBA program that plays videos Conbert appends to it.
# Needs devkitARM (the Docker build uses the devkitpro/devkitarm image).
DEVKITARM ?= /opt/devkitpro/devkitARM
DEVKITPRO ?= /opt/devkitpro

CC      := $(DEVKITARM)/bin/arm-none-eabi-gcc
OBJCOPY := $(DEVKITARM)/bin/arm-none-eabi-objcopy
GBAFIX  := $(DEVKITPRO)/tools/bin/gbafix

ARCH    := -mthumb -mthumb-interwork -mcpu=arm7tdmi -mtune=arm7tdmi
CFLAGS  := $(ARCH) -O2 -std=c11 -Wall -Wextra -Werror -fno-strict-aliasing
LDFLAGS := $(ARCH) -specs=gba.specs

player.gba: player.elf
	$(OBJCOPY) -O binary $< $@
	$(GBAFIX) $@ -tCONBERT -cCNBV -mCB -r1

player.elf: player.c
	$(CC) $(CFLAGS) $(LDFLAGS) $< -o $@

clean:
	rm -f player.elf player.gba

.PHONY: clean
