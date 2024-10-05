<script setup>
import { computed, ref, watch } from "vue";
import axios from "axios";
import cache from "../utils/cache.js";
import maleImages from "../data/male.json";
import femaleImages from "../data/female.json";
import {
  Camera,
  Download,
  MagicStick,
  Upload,
  Back,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";

defineProps({
  msg: String,
});

const LUNA_OSS_BASE_URL =
  "https://iart-user-upload-file.oss-cn-hangzhou.aliyuncs.com";

const demoImagesMale = maleImages.map((item) => {
  return {
    ...item,
    filePath: `${LUNA_OSS_BASE_URL}/${item.filePath}`,
  };
});
const demoImagesFemale = femaleImages.map((item) => {
  return {
    ...item,
    filePath: `${LUNA_OSS_BASE_URL}/${item.filePath}`,
  };
});

const isMale = ref(true);
watch(isMale, (newVal) => {
  selectedImg.value = newVal ? demoImagesMale[0] : demoImagesFemale[0];
});

const selectedImg = ref(null);
selectedImg.value = demoImagesMale[0];
console.log("selectedImg", selectedImg.value);
const onClickImg = (item) => {
  if (isShowLoading.value) {
    return;
  }
  console.log("click img", item);
  selectedImg.value = item;
};

const imageData = ref(null);
const videoElement = ref(null);
const canvasElement = ref(null);
const imageBlob = ref(null);

const takePicture = () => {
  console.log("takePicture");
  const video = videoElement.value;
  const canvas = canvasElement.value;
  const context = canvas.getContext("2d");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.translate(canvas.width, 0); // 将原点移动到画布的右上角
  context.scale(-1, 1); // 水平翻转图像
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  imageData.value = canvas.toDataURL("image/png");

  // 将 Canvas 中的内容转换为 Blob 数据
  canvas.toBlob(function (blob) {
    imageBlob.value = blob;
    nextState();
  }, "image/png");
};

const getAvatar = () => {
  console.log("get avatar");
  window.open(resultImageUrl.value);
};
const resetState = () => {
  console.log("reset camera");
  pollTimer.value && clearInterval(pollTimer.value);
  imageData.value = null;
  state.value = "home";
};
const createTask = () => {
  console.log("create task");
  nextState();
  uploadFile();
};

const countdown = ref(3);
const timer = ref(null);
const pollTimer = ref(null);
const startCountdown = () => {
  nextState();
  countdown.value = 3;
  timer.value = setInterval(() => {
    countdown.value--;
    if (countdown.value === 0) {
      clearInterval(timer.value);
      timer.value = null;
      console.log("拍照！");
      takePicture();
    }
  }, 1000);
};
const host = "https://prod.luna.aws.iartai.com";
const instance = axios.create({
  baseURL: host,
  timeout: 30 * 1000,
});
const checkResponse = (response) => {
  if (response.data.code !== 1) {
    console.error(response.data.message);
    feedbackError(response.data.message);
    return false;
  }
  return true;
};

const getAuthToken = async () => {
  const token = cache.get("token");
  if (token) {
    return token;
  }

  const response = await instance.post("/api/app/authentication", {
    secret: atob("dXlUcVFScUlZQEh5aWFKcGg3cXpQaXlPb09ENyF0NHU="),
    secretKey: atob("NyVubm9uellpM1BC"),
  });
  const success = checkResponse(response);
  if (!success) {
    return;
  }
  const newToken = response.data.data.accessToken;
  cache.set("token", newToken, response.data.data.exceedTheTime - 300);
  return newToken;
};
getAuthToken();

const s3signUrl = ref("");
const fileName = ref("");
const getS3SignUrl = async function (jwtToken) {
  const randomFileName =
    "luna_fuzhou_" +
    new Date().getTime().toString() +
    "_" +
    Math.random().toString(36).substring(2) +
    ".png";
  // 这里替换成接口拿到的临时上传链接
  let url = `/api/userMessage/getJsUploadS3Url?sourceFileName=${randomFileName}`;
  return instance
    .get(url, {
      headers: {
        JWTHEADER: jwtToken,
      },
    })
    .then((response) => {
      const success = checkResponse(response);
      if (!success) {
        return;
      }
      s3signUrl.value = response.data.data.jsS3Url;
      fileName.value = response.data.data.newFileName;
      console.log("获取签名res", response.data);
    })
    .catch((error) => ajaxError(error));
};

const resultImageUrl = ref("");
// 获取文件数据
const uploadFile = async function () {
  const jwtToken = await getAuthToken();
  console.log("jwtToken", jwtToken);

  loading.value = true;
  getS3SignUrl(jwtToken).then(() => {
    uploadToSignUrl().then(() => {
      console.log("上传s3成功");
      instance
        .get("/api/userMessage/checkUserFilePathUpload", {
          headers: {
            JWTHEADER: jwtToken,
          },
          params: {
            newFileName: fileName.value,
            isMaterialFile: 0,
          },
        })
        .then((response) => {
          const success = checkResponse(response);
          if (!success) {
            resetState();
            return;
          }
          console.log("创建作图任务", response.data);

          instance
            .post(
              "/api/userMessage/createSwapEnhance",
              {
                userFileId: response.data.data.id,
                tagFileId: selectedImg.value.fileId,
                gender: isMale.value ? "male" : "female",
                fileSize: 1,
              },
              {
                headers: {
                  JWTHEADER: jwtToken,
                },
              },
            )
            .then((response) => {
              checkResponse(response);
              console.log("提交换脸任务", response.data);

              // 轮询任务状态
              const taskId = response.data.data.messageId;
              const pollTask = () => {
                instance
                  .get("/api/userMessage/polling", {
                    headers: {
                      JWTHEADER: jwtToken,
                    },
                    params: {
                      messageId: taskId,
                    },
                  })
                  .then((response) => {
                    // const success = checkResponse(response)
                    // console.log('轮询任务状态', response.data)
                    if (
                      response.data.code === 0 &&
                      response.data.message.indexOf("太频繁") > -1
                    ) {
                      console.log("轮询不展示限流错误", response.data);
                      return;
                    }
                    checkResponse(response);

                    if (response.data.data.status === 1) {
                      feedbackSuccess("生成成功");
                      clearInterval(pollTimer.value);
                      resultImageUrl.value = `${LUNA_OSS_BASE_URL}/${response.data.data.messageList[0].sourceFilePath}`;
                      loading.value = false;
                      nextState();
                    }

                    if (
                      response.data.data.status === -1 ||
                      response.data.data.status === -2
                    ) {
                      // 消息状态 -1：失败 0：等待中 1：成功 -2：未找到人脸
                      feedbackError(
                        "生成失败请重试 " + response.data.data.status === -1
                          ? "-1失败"
                          : "-2未找到人脸" +
                              " " +
                              response.data.data.errorMsg || "-",
                      );
                      clearInterval(pollTimer.value);
                      loading.value = false;
                      nextState();
                    }
                  })
                  .catch((error) => ajaxError(error));
              };
              pollTimer.value = setInterval(pollTask, 2000);
            })
            .catch((error) => ajaxError(error));
        })
        .catch((error) => ajaxError(error));
    });
  });
};
const uploadToSignUrl = function () {
  let url = s3signUrl.value;
  s3signUrl.value = "";
  return axios
    .put(url, imageBlob.value, {
      headers: {
        "Content-Type": "image/png",
      },
    })
    .then((response) => {
      console.log("URL=", url);
      console.log("上传成功", response.data);
    })
    .catch((error) => ajaxError(error));
};

const ajaxError = function (error) {
  console.error("ajax error", error);
  feedbackError("网络请求失败： " + JSON.stringify(error));
  loading.value = false;
  setTimeout(() => {
    resetState();
  }, 2000);
};

const loading = ref(false);
const feedbackSuccess = (msg = "") => {
  ElMessage({
    message: msg,
    type: "success",
  });
};
const feedbackError = (msg) => {
  ElMessage({
    message: msg,
    type: "error",
    duration: 30 * 1000,
    showClose: true,
  });
};

// 定义计算属性 isShowResult
const isShowResult = computed(() => {
  return state.value === "result";
});
const isShowLoading = computed(() => {
  return state.value === "loading";
});
const isShowCamera = computed(() => {
  return state.value === "camera";
});
const isShowCountDown = computed(() => {
  return state.value === "countdown";
});
const isShowCapture = computed(() => {
  return state.value === "capture";
});
const isShowHome = computed(() => {
  return state.value === "home";
});
// 定义一系列状态
const state = ref("home");
const states = ["home", "camera", "countdown", "capture", "loading", "result"];
const nextState = () => {
  const index = states.indexOf(state.value);
  state.value = states[(index + 1) % states.length];
};

const handleFileChange = (file) => {
  if (file.raw) {
    const blob = new Blob([file.raw], { type: file.raw.type }); // 将文件转换为 Blob
    imageData.value = URL.createObjectURL(blob);
    imageBlob.value = blob;
    state.value = "capture";
  } else {
    alert("未找到文件");
  }
};

const initCamera = () => {
  if (videoElement.value.srcObject) {
    return;
  }
  navigator.mediaDevices
    .getUserMedia({
      video: {
        facingMode: "user",
      },
      audio: false,
    })
    .then((stream) => {
      videoElement.value.srcObject = stream;
    })
    .catch((error) => {
      console.error("init camera error", error);
    });
};
// state不等于camera时关闭摄像头
watch(state, (newVal) => {
  if (newVal == "camera") {
    initCamera();
    return;
  }
  if (newVal !== "camera" && newVal !== "countdown") {
    if (videoElement.value.srcObject) {
      videoElement.value.srcObject.getTracks().forEach((track) => {
        track.stop();
      });
      videoElement.value.srcObject = null;
    }
  }
});

const group = ref("male");
</script>

<template>
  <div class="main">
    <h1 class="text-5xl mb-8">
      Luna AI形象照
      <span class="text-sm text-gray-300">
        <a
          href="https://github.com/loxi-opensource/luna-headshot"
          target="_blank"
          >🌟Github</a
        >
      </span>
    </h1>
    <div class="flex gap-4 h-[700px]">
      <div class="w-[362px] relative">
        <div class="w-full h-[522px] relative">
          <canvas ref="canvasElement" style="display: none"></canvas>
          <img
            v-if="isShowCapture || isShowLoading"
            :src="imageData"
            alt="Captured Image"
            class="object-cover w-full h-full rounded-lg"
          />
          <img
            v-if="isShowResult"
            :src="resultImageUrl"
            alt="Result Image"
            class="object-cover w-full h-full rounded-lg"
          />
          <div
            class="absolute top-0 left-0 w-full h-full flex justify-center items-center bg-black bg-opacity-60"
            v-if="isShowLoading"
          >
            <div class="loader"></div>
          </div>
          <div
            class="w-full h-full flex flex-col items-center justify-center gap-4 bg-gray-700 rounded-lg"
            v-if="isShowHome"
          >
            <ElButton
              @click="nextState"
              type="warning"
              size="large"
              :icon="Camera"
              >拍照
            </ElButton>
            <el-upload
              ref="upload"
              class="upload-demo"
              :limit="1"
              :auto-upload="false"
              :on-change="handleFileChange"
              accept="image/png, image/jpeg, image/jpg, image/webp"
            >
              <template #trigger>
                <el-button type="primary" size="large" :icon="Upload"
                  >上传
                </el-button>
              </template>
            </el-upload>
          </div>
          <video
            class="absolute top-0 left-0 w-full h-full object-cover rounded-lg"
            style="transform: scaleX(-1); -webkit-transform: scaleX(-1)"
            ref="videoElement"
            autoplay
            v-show="isShowCamera || isShowCountDown"
          ></video>
          <div
            class="absolute top-0 left-0 w-full h-full flex flex-col justify-center items-center"
            v-if="isShowCamera || isShowCountDown"
          >
            <div
              class="camera-overlay-btn relative"
              @click="startCountdown"
              v-if="isShowCamera"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="174"
                height="174"
                viewBox="0 0 174 174"
                fill="none"
              >
                <circle cx="87" cy="87" r="87" fill="#8186FF" />
                <text
                  x="87"
                  y="87"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  alignment-baseline="middle"
                  fill="#ffffff"
                  font-size="24"
                >
                  拍照
                </text>
              </svg>
            </div>
            <span class="camera-overlay-tips mt-2" v-if="isShowCamera"
              >点击屏幕后倒数3秒后开始拍照</span
            >
            <div class="countdown" v-if="isShowCountDown">
              <div v-show="countdown == 3" class="fade text-7xl">
                {{ countdown }}
              </div>
              <div v-show="countdown == 2" class="fade text-7xl">
                {{ countdown }}
              </div>
              <div v-show="countdown == 1" class="fade text-7xl">
                {{ countdown }}
              </div>
            </div>
          </div>
        </div>
        <div
          class="toolbar mt-4 w-full"
          v-if="isShowHome || isShowCamera || isShowCountDown"
        >
          <el-radio-group v-model="group" size="large">
            <el-radio-button value="female" @click="isMale = false">
              女士形象
            </el-radio-button>
            <el-radio-button value="male" @click="isMale = true">
              男士形象
            </el-radio-button>
            <el-tooltip
              content="<p align='center' class='mt-2'>微信扫一扫</p><img
                src='/assets/qrcode.jpg'
            alt='qrcode'
            class='rounded w-[200px] h-[200px] m-2'
            />"
              raw-content
            >
              <el-radio-button value="portrait">AI写真照</el-radio-button>
            </el-tooltip>
          </el-radio-group>
        </div>
        <div class="toolbar mt-4 w-full" v-if="isShowCapture">
          <ElButton
            @click="resetState"
            class="secondary w-[160px]"
            size="large"
            :icon="Back"
            >返回首页
          </ElButton>
          <ElButton
            @click="createTask"
            type="primary"
            class="w-[160px]"
            :icon="MagicStick"
            size="large"
            >免费制作AI形象照
          </ElButton>
        </div>
        <div class="toolbar mt-4 w-full" v-if="isShowLoading">
          <ElButton
            @click="resetState"
            class="secondary w-[160px]"
            size="large"
            :icon="Back"
            >返回首页
          </ElButton>
          <ElButton
            type="primary"
            size="large"
            class="secondary w-[160px]"
            loading
            >大约需要20秒</ElButton
          >
        </div>
        <div class="toolbar mt-4 w-full" v-if="isShowResult">
          <ElButton
            @click="resetState"
            class="secondary w-[160px]"
            size="large"
            :icon="Back"
            type="danger"
            >不保存，返回首页
          </ElButton>
          <ElButton
            @click="getAvatar"
            type="primary"
            size="large"
            class="w-[160px]"
            :icon="Download"
            >下载图片
          </ElButton>
        </div>
        <div
          class="mt-4 w-full absolute bottom-0 flex flex-col gap-2 justify-start"
        >
          <p class="text-sm">算法能力由LunaAI支持，支持自定义换装换发型</p>
          <p class="text-sm">
            LunaAI换脸开源项目：
            <span>
              <a
                class="text-orange-300 mr-2"
                href="https://github.com/loxi-opensource/luna-swapping"
                target="_blank"
                >Github</a
              >
              <a
                class="text-orange-300"
                href="https://gitee.com/loxi-open-source/luna-swapping"
                target="_blank"
                >Gitee码云</a
              >
            </span>
          </p>
          <p class="text-sm">
            联系开发者：
            <el-tooltip
              content="<p align='center' class='mt-2'>添加微信</p><img
                src='/assets/wechat-contact-crop.jpg'
            alt='qrcode'
            class='rounded w-[150px] h-[150px] m-2'
            />"
              raw-content
            >
              <span class="text-orange-300">微信</span>
            </el-tooltip>
          </p>
        </div>
      </div>
      <div
        class="image-style-list flex-1 flex flex-wrap gap-4 overflow-auto mx-2"
      >
        <div
          v-for="(item, index) in isMale ? demoImagesMale : demoImagesFemale"
          :key="index"
          :class="[
            'grid-item border-4 box-border rounded-lg',
            selectedImg?.fileId === item.fileId
              ? 'border-[#FFA869]'
              : 'border-transparent',
          ]"
          @click="onClickImg(item)"
        >
          <img
            :src="item.filePath.replace('public/', '')"
            alt="luna"
            class="object-cover w-[180px] h-[270px] rounded"
          />
        </div>
      </div>
    </div>
  </div>
</template>
<style lang="css">
.fade {
  animation: fadeInOut 1s ease-in-out;
}

@keyframes fadeInOut {
  0% {
    opacity: 0;
  }
  33% {
    opacity: 1;
  }
  66% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

.loader {
  width: 200px;
  height: 18px;
  border-radius: 20px;
  color: #cb95ed;
  border: 2px solid;
  position: relative;
}
.loader::before {
  content: "";
  position: absolute;
  margin: 2px;
  inset: 0 100% 0 0;
  border-radius: inherit;
  background: currentColor;
  animation: l6 2s infinite;
}
@keyframes l6 {
  100% {
    inset: 0;
  }
}

/* styles.css */
::-webkit-scrollbar {
  width: 4px; /* 滚动条宽度 */
}

::-webkit-scrollbar-track {
  background: #f1f1f1; /* 滚动条轨道背景 */
}

::-webkit-scrollbar-thumb {
  background: #888; /* 滚动条颜色 */
}

.el-dialog {
  background-color: rgb(17 24 39 / var(--tw-bg-opacity));
}
</style>
