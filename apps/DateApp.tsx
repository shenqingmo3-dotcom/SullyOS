import React from 'react';
import { useOS } from '../context/OSContext';
import StoryTheater from '../components/date/story/StoryTheater';

/**
 * “见面”现在直接承载原剧情模式的沉浸式楼层玩法。
 * 日常线上/线下状态仍由聊天页统一管理；这里不再保留第二套陪伴聊天入口。
 */
const DateApp: React.FC = () => {
    const { closeApp } = useOS();
    return <StoryTheater onClose={closeApp} />;
};

export default DateApp;
