# Read with upstream's Makefile (make -f Makefile -f print.mk print-VAR) to
# print one of its variables exactly, so build.sh compiles Rogue Archive's
# added file with upstream's own flags.
print-%:
	$(info $($*))@:
