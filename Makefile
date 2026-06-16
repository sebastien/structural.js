##  SDK Bootstrapping
SDK_PATH=deps/sdk
MODULES=std js mise
JS_BUNDLE_ENTRY=src/js/structural/index.js
JS_BUNDLE_DEBUG_OUTPUT=$(PATH_DIST)/structural.js
JS_BUNDLE_OUTPUT=$(PATH_DIST)/structural.min.js
include $(if $(SDK_PATH),$(shell test ! -e "$(SDK_PATH)/setup.mk" && git clone git@github.com:littletoolkit/littlesdk.git "$(SDK_PATH)";echo "$(SDK_PATH)/setup.mk"))

DIST_ALL+=$(JS_BUNDLE_DEBUG_OUTPUT) $(JS_BUNDLE_OUTPUT) $(JS_BUNDLE_OUTPUT).gz

# EOF
